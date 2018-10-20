import { DataTypeManager } from "../../data-type";
import { rootColumnType, typeParser, typeValueExampleRender } from "../../data-type/type-parser";
import { CassandraTable } from "../../types";

export const tableDelete = (keyspace: string, data: CassandraTable): Promise<string> => {
    return new Promise((resolve, reject) => {

        const dtm = new DataTypeManager();
        const name = `${data.name}`;
        const pks = data.primaryKeys;
        const updatables = data.columns.filter((c) => c.kind === "regular");

        const pkConditions = pks.map((c) => {
            const ctype = rootColumnType(c.type);
            const dt = dtm.get(ctype, null);
            return `${c.name}=${dt.stringPlaceholder}`;
        });

        const columns = updatables.map((c) => {
            try {

                const dataAnalysis = typeParser(c.type);
                const val = typeValueExampleRender(dataAnalysis);
                return `\t${c.name}=${val}`;
            } catch (e) {
                console.log(`ERROR generating data for ${c.name}/${c.type}`);
                console.log(e);
            }
        });

        const lines: string[] = [
            `DELETE FROM ${keyspace}.${name}`,
            `WHERE ${pkConditions.join(" AND ")};`,
        ];

        resolve(lines.join("\n"));

    });
};