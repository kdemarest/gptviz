unit("dependency-commands", ["plugin"], () => {
Object.assign(GPTViz.Plugin.prototype, {
    async checkDependencies() {
        try {
            const rows = await GPTViz.findStaleDependencies(this.app);

            if (rows.length === 0) {
                new GPTViz.obsidian.Notice(
                    "GPTViz: no stale image dependencies found."
                );
                return;
            }

            new GPTViz.DependencyModal(this.app, rows).open();
        } catch (error) {
            this.reportError("checking image dependencies", error);
        }
    },

    async checkImageIntegrity() {
        try {
            const rows = await GPTViz.findInvalidImageReferences(this.app);

            if (rows.length === 0) {
                new GPTViz.obsidian.Notice(
                    "GPTViz: no invalid image references found."
                );
                return;
            }

            new GPTViz.ImageIntegrityModal(this.app, rows).open();
        } catch (error) {
            this.reportError("checking image integrity", error);
        }
    },

    async validateDependencyHeadings() {
        try {
            const report = await GPTViz.buildDependencyHeadingReport(this.app);
            const reportPath = GPTViz.contentPath("_deps.md");
            let reportFile = this.app.vault.getAbstractFileByPath(reportPath);
            if (reportFile) {
                await this.app.vault.modify(reportFile, report.markdown);
            } else {
                reportFile = await this.app.vault.create(reportPath, report.markdown);
            }

            const markdownLeaves = this.app.workspace.getLeavesOfType("markdown");
            const existingLeaf = markdownLeaves.find(leaf => leaf.view.file?.path === reportFile.path);

            if (existingLeaf) {
                await this.app.workspace.revealLeaf(existingLeaf);
            } else {
                await (markdownLeaves[0] || this.app.workspace.getLeaf(false)).openFile(reportFile);
            }

            const summary = `GPTViz: dependency validation wrote ${reportPath} (${report.errors.length} error${report.errors.length === 1 ? "" : "s"}, ${report.warnings.length} warning${report.warnings.length === 1 ? "" : "s"}).`;
            new GPTViz.obsidian.Notice(summary);
        } catch (error) {
            this.reportError("validating dependency headings", error);
        }
    }
});
});
