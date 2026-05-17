import { typesense } from "./typesense.js";

const KEY_VALUE = "viesduomenys";

async function main() {
    const key = await typesense.keys().create({
        description: "Readonly search key for viesduomenys",
        value: KEY_VALUE,
        actions: ["documents:search"],
        collections: ["*"],
    });

    console.log("Created Typesense API key:");
    console.log(key);
}

main().catch((err) => {
    console.error("Failed to create Typesense API key:");
    console.error(err);
    process.exit(1);
});