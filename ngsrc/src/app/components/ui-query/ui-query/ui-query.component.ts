import {
    ChangeDetectionStrategy, ChangeDetectorRef,
    Component, ElementRef, EventEmitter, Input, OnDestroy, OnInit, Output, ViewChild,
} from "@angular/core";
import { MatSnackBar } from "@angular/material";
import { ReplaySubject, Subject } from "rxjs";
import { debounceTime, take, takeUntil } from "rxjs/operators";
import * as Split from "split.js";

import { AnimationEvent } from "@angular/animations";
import { merge } from "rxjs";
import { CqlAnalysisError } from "../../../../../../src/parser/listeners/cql-analyzer";
import { WorkbenchCqlStatement } from "../../../../../../src/types/editor";
import { CassandraCluster, CassandraClusterData, CassandraKeyspace, ExecuteQueryResponse } from "../../../../../../src/types/index";
import { ViewDestroyable } from "../../../base/view-destroyable/index";
import { ClusterService } from "../../../services/cluster/cluster.service";
import { CqlClientService } from "../../../services/cql-client/cql-client.service";
import { EditorService } from "../../../services/editor/editor.service";
import { ThemeService } from "../../../services/theme/theme.service";
import { WorkbenchEditor } from "../../../types/index";
import { UiMonacoEditorComponent } from "../../ui-monaco-editor/ui-monaco-editor/ui-monaco-editor.component";
import { panelAnimations } from "./animations/panel";

type PanelAnimationState = "active" | "hidden";

@Component({
    selector: "ui-query",
    templateUrl: "./ui-query.component.html",
    styleUrls: ["./ui-query.component.scss"],
    changeDetection: ChangeDetectionStrategy.OnPush,
    animations: [
        ...panelAnimations,
    ],
})
export class UiQueryComponent extends ViewDestroyable implements OnInit, OnDestroy {
    @Output("onStatementChange") public onStatementChange = new EventEmitter<WorkbenchCqlStatement>();

    @ViewChild("top") public top: ElementRef<HTMLDivElement>;
    @ViewChild("bottom") public bottom: ElementRef<HTMLDivElement>;
    @ViewChild("monacoEditor") public monacoEditor: UiMonacoEditorComponent;
    @ViewChild("grid") public grid: ElementRef<HTMLTableElement>;

    public clusterLast: string = null;
    public clusterLoading: boolean = false;
    public clusterLoadingError: boolean = false;

    public clusterData: CassandraClusterData = null;
    public clusterList: CassandraCluster[] = [];
    public keyspaceList: CassandraKeyspace[] = [];

    public editors: WorkbenchEditor[] = [];
    public editorCurrent: WorkbenchEditor = null;
    public editorIndex: number = -1;

    public fontSize: number = 15;
    public lineHeight: number = 23;

    private stateReady = new ReplaySubject<void>();
    private eventCodeChange = new Subject<WorkbenchCqlStatement>();

    public columnDefs: any[];
    public rowData: any[];

    private decorations: string[] = [];
    private decorationsTimeout: any;

    public panelAnimationState: { [id: string]: string };

    constructor(
        public change: ChangeDetectorRef,
        public cluster: ClusterService,
        public cqlClient: CqlClientService,
        public theme: ThemeService,
        public snackBar: MatSnackBar,
        public editorService: EditorService,
    ) {
        super(change);

        this.clusterList = this.cluster.list;
        this.fontSize = Math.round(theme.getEditorFontSize() * 1.2);
        this.lineHeight = Math.round(this.fontSize * 1.5);

    }
    public trackEditor(index: number, e: WorkbenchEditor) {
        console.log(`trackEditor ${e.id}`);
        return e.id;
    }
    public panelAnimationDone = (event: AnimationEvent) => {
        console.log(`panelAnimation ${event.fromState} -> ${event.toState}`);
    }
    public get editor() {
        return this.editorCurrent;
    }
    @Input("editor") public set editor(editor: WorkbenchEditor) {
        this.stateReady.pipe(
            take(1),
        ).subscribe(() => {

            this.editorCurrent = editor;

            if (this.editorCurrent.statement.clusterName !== this.clusterLast) {
                this.prepareCluster(this.editorCurrent.statement.clusterName);
            }
            this.activateEditorPanel(editor);
            this.detectChanges();

        });

        merge(this.editorService.eventListChange, this.editorService.stateActive).pipe(
            takeUntil(this.eventViewDestroyed),
        ).subscribe(() => {
            this.editors = this.editorService.list;
            this.editorIndex = this.editors.findIndex((e) => e.id === this.editor.id);

            this.activateEditorPanel(this.editor);
            this.detectChanges();
        });
        // .
    }
    ngOnInit() {

        Split([this.top.nativeElement, this.bottom.nativeElement], {
            direction: "vertical",
            gutterSize: 12,
        });

        this.cluster.eventChange.pipe()
            .subscribe(() => {
                this.clusterList = this.cluster.list;
                this.detectChanges();
            });

        this.stateReady.next();

        this.eventCodeChange.pipe(
            takeUntil(this.eventViewDestroyed),
            debounceTime(1000),
        ).subscribe((d) => {
            this.onStatementChange.emit(d);
        });

        // this.cqlClient.stateExecuting.pipe(
        //     takeUntil(this.eventViewDestroyed),
        // ).subscribe(() => this.detectChanges());

    }
    ngOnDestroy() {
        super.ngOnDestroy();
    }
    public activateEditorPanel(editor: WorkbenchEditor) {
        console.log(`panel Activating ${editor.id}`);
        const states = {};
        this.editorService.list.forEach((e) => {
            if (this.editorCurrent.id === e.id) {
                states[e.id] = "active";
                return;
            }
            states[e.id] = "hidden";
        });
        this.panelAnimationState = states;

    }

    public updateEditor(editor: WorkbenchEditor) {

    }

    public onCodeChange = (code: string) => {

        this.editorCurrent.statement.body = code;
        this.eventCodeChange.next(this.editorCurrent.statement);
    }
    public onClusterChange = (clusterName: string) => {
        console.log(`onClusterChange ${clusterName}`);
        this.editorCurrent.statement.clusterName = clusterName;
        this.onStatementChange.emit(this.editorCurrent.statement);
        this.keyspaceList = [];
        this.detectChanges();

        this.prepareCluster(clusterName);

    }
    public onKeyspaceChange = (keyspace: string) => {
        console.log(`onKeyspaceChange ${keyspace}`);
        this.editorCurrent.statement.keyspace = keyspace;
        this.onStatementChange.emit(this.editorCurrent.statement);
    }
    public executeCql = () => {

        if (this.clusterLoading || this.clusterLoadingError) {
            return;
        }

        this.editorCurrent.result = null;
        this.detectChanges();

        this.cqlClient.executeEditor(this.editorCurrent)
            .then((response: ExecuteQueryResponse) => {
                console.log("[cqlClient.execute] Got result !!!");

                if (response.error) {
                    this.processExecuteError(response);
                    return;
                }

                this.detectChanges();

            }).catch((e) => {
                this.snackBar.open(e, "OK", {
                    duration: 1000,
                });
            });

    }

    public processExecuteError(response: ExecuteQueryResponse) {
        let message: string = "";
        switch (response.error) {
            case CqlAnalysisError.SELECT_AND_ALTER:
                message = "Unable to execute SELECT statement along with data or structure altering statements";
                break;
            case CqlAnalysisError.MULTIPLE_SELECT:
                message = "Unable to execute multiple SELECT statements";
                break;
            default:
                message = `ERROR: ${JSON.stringify(response.error)}`;
                break;

        }

        this.snackBar.open(message, "OK", {
            duration: 10000,
        });
    }
    public onErrorClick = (ev: Event, index: number) => {
        console.log(`onErrorClick ${index}`);

        if (this.decorationsTimeout) {
            clearTimeout(this.decorationsTimeout);
            this.decorationsTimeout = null;
        }

        const statement = this.editorCurrent.result.analysis.statements[index];
        const error = this.editorCurrent.result.errors.find((e) => e.statementIndex === index);
        const editor = this.monacoEditor.monacoEditor;
        const model = editor.getModel();

        const ps = model.getPositionAt(statement.charStart);
        const pe = model.getPositionAt(statement.charStop + 1);

        editor.revealPositionInCenter(ps, monaco.editor.ScrollType.Immediate);

        // model.getAllDecorations().forEach((e)=>e.)
        this.decorations = editor.deltaDecorations(this.decorations, [
            {
                range: monaco.Range.fromPositions(ps, pe), options: {
                    className: "highlight-error",
                    hoverMessage: {
                        value: error ? error.error.message : null,
                    },
                },
            },
        ]);

        this.decorationsTimeout = setTimeout(() => {
            this.decorations = editor.deltaDecorations(this.decorations, []);
        }, 1000);

    }
    private prepareCluster(clusterName: string) {

        this.clusterLoading = true;

        this.cluster.getStructure(clusterName).pipe()
            .subscribe((data) => {
                this.clusterLast = clusterName;
                this.clusterData = data;
                this.keyspaceList = data.keyspaces;

                this.clusterLoading = false;
                this.clusterLoadingError = false;
                this.detectChanges();
            }, (e) => {
                this.snackBar.open("Error loading cluster structure");
                console.log(e);
                this.clusterLoading = false;
                this.clusterLoadingError = true;
                this.detectChanges();
            });

    }
}
