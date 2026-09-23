/*
 * ESLint, configured with Microsoft's eslint-plugin-powerbi-visuals.
 *
 * The plugin's `recommended` set is what the certification review runs: it is the
 * rule set that fails a visual for eval / Function(), innerHTML written from data,
 * XMLHttpRequest, fetch, WebSocket, external resources and the rest of the
 * forbidden-API list. Running it here means the review finds nothing we have not
 * already seen.
 *
 * `test/` holds the Playwright harness used to develop the visual. It never ships
 * inside the .pbiviz - only `src/` is compiled - but it is linted all the same so
 * nothing forbidden creeps in through a fixture.
 */
import powerbiVisualsConfigs from "eslint-plugin-powerbi-visuals";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
    powerbiVisualsConfigs.configs.recommended,
    {
        ignores: [
            "node_modules/**",
            "dist/**",
            ".tmp/**",
            ".vscode/**",
            "shots/**",
            "webpack.statistics.*.html"
        ]
    },
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: {
                ecmaVersion: 2019,
                sourceType: "module"
            }
        },
        plugins: {
            "@typescript-eslint": tseslint
        },
        rules: {
            "@typescript-eslint/no-unused-vars": "error"
        }
    }
];
