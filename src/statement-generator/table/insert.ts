import { typeParser, typeValueExampleRender } from "../../data-type/type-parser";
import { CassandraTable } from "../../types";
import { isCaseSensitive } from "../base/helpers";

export const tableInsert = (keyspace: string, data: CassandraTable): Promise<string> => {
    return new Promise((resolve, reject) => {

        const name = `${data.name}`;
        const pks = data.primaryKeys;
        const updatables = data.columns.filter((c) => c.kind === "regular");
        const columns = pks.concat(updatables);
        const names = columns.map((c) => {
            const cs = isCaseSensitive(c.name);
            if (cs) {
                return `\t"${c.name}"`;
            } else {
                return `\t${c.name}`;
            }
        });

        const values = columns.map((c) => {
            try {

                const dataAnalysis = typeParser(c.type);
                const val = typeValueExampleRender(dataAnalysis);
                return `\t${val}`;
            } catch (e) {
                console.log(`ERROR generating data for ${c.name}/${c.type}`);
                console.log(e);
            }
        });

        const tcs = isCaseSensitive(name);
        const tableName = tcs ? `"${name}"` : name;

        const lines: string[] = [
            `INSERT INTO ${keyspace}.${tableName}(`,
            `${names.join(", \n")}`,
            `)`,
            `VALUES(`,
            `${values.join(", \n")}`,
            `);`,
        ];

        resolve(lines.join("\n"));

    });
};
