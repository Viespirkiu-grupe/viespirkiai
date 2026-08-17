import fs from "node:fs/promises";
import path from "node:path";

const ROOT = process.cwd();
const OUTPUT_DIR = path.join(ROOT, "tmp");
const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
const lock = JSON.parse(await fs.readFile(path.join(ROOT, "package-lock.json"), "utf8"));

const roots = [
    ...Object.keys(packageJson.dependencies ?? {}).map((name) => ({ name, type: "runtime" })),
    ...Object.keys(packageJson.devDependencies ?? {}).map((name) => ({ name, type: "dev" })),
];

function rootLocator(name) {
    return `node_modules/${name}`;
}

function resolveDependency(locator, dependency) {
    let current = locator;

    while (current) {
        const candidate = `${current}/node_modules/${dependency}`;
        if (lock.packages?.[candidate]) return candidate;

        const nestedAt = current.lastIndexOf("/node_modules/");
        current = nestedAt === -1 ? "" : current.slice(0, nestedAt);
    }

    const candidate = rootLocator(dependency);
    return lock.packages?.[candidate] ? candidate : null;
}

function dependenciesOf(locator) {
    const pkg = lock.packages?.[locator];
    return Object.keys({
        ...(pkg?.dependencies ?? {}),
        ...(pkg?.optionalDependencies ?? {}),
    }).map((dependency) => resolveDependency(locator, dependency)).filter(Boolean);
}

function collectTree(rootName) {
    const result = new Set();
    const pending = [rootLocator(rootName)];

    while (pending.length > 0) {
        const locator = pending.pop();
        if (result.has(locator) || !lock.packages?.[locator]) continue;
        result.add(locator);
        pending.push(...dependenciesOf(locator));
    }

    return result;
}

async function directorySize(directory) {
    let total = 0;
    let entries;

    try {
        entries = await fs.readdir(directory, { withFileTypes: true });
    } catch {
        return 0;
    }

    for (const entry of entries) {
        if (entry.name === "node_modules") continue;
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            total += await directorySize(entryPath);
        } else if (entry.isFile()) {
            total += (await fs.stat(entryPath)).size;
        }
    }

    return total;
}

function formatBytes(bytes) {
    if (!bytes) return "0 B";
    const units = ["B", "KiB", "MiB", "GiB"];
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    return `${(bytes / 1024 ** unit).toFixed(unit === 0 ? 0 : 1)} ${units[unit]}`;
}

function markdownTable(rows) {
    const lines = [
        "| Dependency | Own size | Tree size | Unique size | Packages |",
        "|---|---:|---:|---:|---:|",
    ];

    for (const row of rows) {
        lines.push(
            `| \`${row.name}\` | ${formatBytes(row.ownSize)} | ${formatBytes(row.treeSize)} | ${formatBytes(row.uniqueSize)} | ${row.packageCount} |`,
        );
    }

    return lines.join("\n");
}

function terminalTable(rows) {
    const columns = [
        { title: "Dependency", value: (row) => row.name, align: "left" },
        { title: "Own size", value: (row) => formatBytes(row.ownSize), align: "right" },
        { title: "Tree size", value: (row) => formatBytes(row.treeSize), align: "right" },
        { title: "Unique size", value: (row) => formatBytes(row.uniqueSize), align: "right" },
        { title: "Packages", value: (row) => String(row.packageCount), align: "right" },
    ];
    const values = rows.map((row) => columns.map((column) => column.value(row)));
    const widths = columns.map((column, index) => Math.max(
        column.title.length,
        ...values.map((row) => row[index].length),
    ));
    const border = (left, middle, right) => left + widths.map((width) => "─".repeat(width + 2)).join(middle) + right;
    const renderRow = (cells) => `│ ${cells.map((cell, index) => {
        const padding = columns[index].align === "right" ? "padStart" : "padEnd";
        return cell[padding](widths[index]);
    }).join(" │ ")} │`;

    return [
        border("┌", "┬", "┐"),
        renderRow(columns.map((column) => column.title)),
        border("├", "┼", "┤"),
        ...values.map(renderRow),
        border("└", "┴", "┘"),
    ].join("\n");
}

function packageLabel(locator) {
    const pkg = lock.packages?.[locator];
    const name = pkg?.name ?? locator.split("/node_modules/").at(-1).replace(/^node_modules\//, "");
    return `${name}@${pkg?.version ?? "unknown"}`;
}

function renderTree(rootName) {
    const root = rootLocator(rootName);
    const seen = new Set();
    const lines = [];

    function visit(locator, prefix, isLast, isRoot = false) {
        const repeated = seen.has(locator);
        const branch = isRoot ? "" : `${isLast ? "└─" : "├─"} `;
        lines.push(`${prefix}${branch}${packageLabel(locator)} [${formatBytes(packageSizes.get(locator) ?? 0)}]${repeated ? " (shared/repeated)" : ""}`);
        if (repeated) return;
        seen.add(locator);

        const children = dependenciesOf(locator);
        const childPrefix = prefix + (isRoot ? "" : (isLast ? "   " : "│  "));
        children.forEach((child, index) => visit(child, childPrefix, index === children.length - 1));
    }

    visit(root, "", true, true);
    return lines.join("\n");
}

const packageLocators = Object.keys(lock.packages ?? {})
    .filter((key) => key.startsWith("node_modules/"));

const packageSizes = new Map();
await Promise.all(packageLocators.map(async (locator) => {
    packageSizes.set(locator, await directorySize(path.join(ROOT, locator)));
}));

const trees = new Map(roots.map(({ name }) => [name, collectTree(name)]));
const usageCount = new Map();
for (const tree of trees.values()) {
    for (const locator of tree) usageCount.set(locator, (usageCount.get(locator) ?? 0) + 1);
}

const report = roots.map(({ name, type }) => {
    const tree = trees.get(name);
    const treeSize = [...tree].reduce((sum, locator) => sum + (packageSizes.get(locator) ?? 0), 0);
    const uniqueSize = [...tree]
        .filter((locator) => usageCount.get(locator) === 1)
        .reduce((sum, locator) => sum + (packageSizes.get(locator) ?? 0), 0);

    return {
        name,
        type,
        ownSize: packageSizes.get(rootLocator(name)) ?? 0,
        treeSize,
        uniqueSize,
        packageCount: tree.size,
        dependencies: [...tree].sort().map((locator) => ({
            locator,
            size: packageSizes.get(locator) ?? 0,
        })),
    };
}).sort((a, b) => b.treeSize - a.treeSize);

const installedSize = [...packageSizes.values()].reduce((sum, size) => sum + size, 0);
const runtimeReport = report.filter(({ type }) => type === "runtime");
const devReport = report.filter(({ type }) => type === "dev");
const treeText = report.map(({ name, type, treeSize, uniqueSize }) => [
    `## ${name} (${type})`,
    "",
    `Tree: ${formatBytes(treeSize)}; unique: ${formatBytes(uniqueSize)}`,
    "",
    "```text",
    renderTree(name),
    "```",
].join("\n")).join("\n\n");
const markdown = [
    "# Dependency sizes",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    `Installed package data: ${formatBytes(installedSize)}`,
    "",
    "`Tree size` includes shared packages and therefore must not be summed. `Unique size` is the disk space reachable from only that direct dependency.",
    "",
    "## Runtime dependencies",
    "",
    markdownTable(runtimeReport),
    "",
    "## Development dependencies",
    "",
    markdownTable(devReport),
    "",
    "# Trees",
    "",
    treeText,
    "",
].join("\n");

await fs.mkdir(OUTPUT_DIR, { recursive: true });
await Promise.all([
    fs.writeFile(path.join(OUTPUT_DIR, "dependency-sizes.md"), markdown),
    fs.writeFile(path.join(OUTPUT_DIR, "dependency-sizes.json"), `${JSON.stringify({
        generatedAt: new Date().toISOString(),
        installedSize,
        dependencies: report,
    }, null, 2)}\n`),
]);

console.log("Runtime dependencies");
console.log(terminalTable(runtimeReport));
console.log("\nDevelopment dependencies");
console.log(terminalTable(devReport));
console.log(`\nWrote ${path.relative(ROOT, path.join(OUTPUT_DIR, "dependency-sizes.md"))}`);
console.log(`Wrote ${path.relative(ROOT, path.join(OUTPUT_DIR, "dependency-sizes.json"))}`);
