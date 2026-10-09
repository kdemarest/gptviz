unit("settings", [], () => {
globalThis.GPTViz = globalThis.GPTViz || {};

GPTViz.obsidian = GPTViz.obsidian || require("obsidian");

GPTViz.DEFAULT_SETTINGS = {
    apiKeySecret: ""
};

GPTViz.SettingTab = class extends GPTViz.obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const containerEl = this.containerEl;

        containerEl.empty();

        new GPTViz.obsidian.Setting(containerEl)
            .setName("OpenAI API key")
            .setDesc("Select or create the secret containing your OpenAI API key.")
            .addComponent(el =>
                new GPTViz.obsidian.SecretComponent(this.app, el)
                    .setValue(this.plugin.settings.apiKeySecret)
                    .onChange(async value => {
                        this.plugin.settings.apiKeySecret = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
};
});
