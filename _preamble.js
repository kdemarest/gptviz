// Order-independent assembly. Every source file wraps its code in unit(name, deps, factory).
// build.sh places this file first and ends the bundle with runUnits(), which runs each factory
// once, after its dependencies. File order in the bundle never matters; declared deps do.
const __units = new Map();

function unit(name, deps, factory) {
    if (__units.has(name)) {
        throw new Error(`unit "${name}" is registered twice`);
    }
    __units.set(name, { deps, factory, state: "pending" });
}

function runUnits() {
    const run = (name, chain) => {
        const entry = __units.get(name);
        if (!entry) {
            throw new Error(`unit "${chain[chain.length - 1]}" depends on unknown unit "${name}"`);
        }
        if (entry.state === "done") {
            return;
        }
        if (entry.state === "running") {
            throw new Error(`unit dependency cycle: ${[...chain, name].join(" -> ")}`);
        }
        entry.state = "running";
        for (const dep of entry.deps) {
            run(dep, [...chain, name]);
        }
        entry.factory();
        entry.state = "done";
    };

    for (const name of __units.keys()) {
        run(name, []);
    }
}
