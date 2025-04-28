import { App, Plugin, WorkspaceLeaf, ItemView, WorkspaceSplit, setIcon, Setting, PluginSettingTab, TFile } from "obsidian";

const VIEW_TYPE_STATS = "notescape-stats-view";

interface NotescapePluginSettings {
	showSkillNames: boolean;
	updateInterval: number; // minutes
	savedSkills?: { [key: string]: SkillData };
}

const DEFAULT_SETTINGS: NotescapePluginSettings = {
	showSkillNames: true,
	updateInterval: 5
}

interface SkillData {
	name: string;
	xp: number;
	icon: string;
}

function calculateXpForLevel(level: number): number {
	// linear scaling with a bit of exponential increase
	return Math.floor(50 * level + 5 * Math.pow(level, 1.5));
}

function calculateLevelForXp(xp: number): number {
	let level = 0;
	while (xp >= calculateXpForLevel(level)) {
		level++;
	}
	return Math.max(0, level - 1);
}

class Skill {
	name: string;
	xp: number;
	icon: string;
	level: number;

	constructor(data: SkillData) {
		this.name = data.name;
		this.xp = data.xp;
		this.icon = data.icon;
		this.level = calculateLevelForXp(this.xp);
	}

	updateLevel() {
		this.level = calculateLevelForXp(this.xp);
	}
}

interface SkillCalculator {
	calculateXp(plugin: NotescapePlugin): Promise<number>;
}

class ScribeSkillCalculator implements SkillCalculator {
	async calculateXp(plugin: NotescapePlugin): Promise<number> {
		let initialXp = 0;
		const files = plugin.app.vault.getMarkdownFiles();
		for (const file of files) {
			const content = await plugin.getFileContent(file);
			const wordCount = content.split(/\s+/).reduce((count, word) => word ? count + 1 : count, 0);
			initialXp += Math.floor(wordCount / 100);
		}
		return initialXp;
	}
}

class ArchivistSkillCalculator implements SkillCalculator {
	async calculateXp(plugin: NotescapePlugin): Promise<number> {
		let initialXp = 0;
		const files = plugin.app.vault.getMarkdownFiles();
		for (const file of files) {
			initialXp += 8;
		}
		return initialXp;
	}
}

class HoarderSkillCalculator implements SkillCalculator {
	async calculateXp(plugin: NotescapePlugin): Promise<number> {
		let initialXp = 0;
		const files = plugin.app.vault.getFiles();
		for (const file of files) {
			initialXp += 8;
		}
		return initialXp;
	}
}

class CuratorSkillCalculator implements SkillCalculator {
	async calculateXp(plugin: NotescapePlugin): Promise<number> {
		let initialXp = 0;
		const files = plugin.app.vault.getFiles();
		for (const file of files) {
			if (!(file.extension == "md")) {
				initialXp += 5;
			}
		}
		return initialXp;
	}
}

class ConnectorSkillCalculator implements SkillCalculator {
	async calculateXp(plugin: NotescapePlugin): Promise<number> {
		let initialXp = 0;
		const files = plugin.app.vault.getMarkdownFiles();
		for (const file of files) {
			const content = await plugin.getFileContent(file);
			const linkCount = (content.match(/\[\[.*?\]\]/g) || []).length;
			initialXp += linkCount;
		}
		return initialXp;
	}
}

class TaskmasterSkillCalculator implements SkillCalculator {
	async calculateXp(plugin: NotescapePlugin): Promise<number> {
		let initialXp = 0;
		const files = plugin.app.vault.getMarkdownFiles();
		for (const file of files) {
			const content = await plugin.getFileContent(file);
			const taskCount = (content.match(/- \[x\]/g) || []).length;
			initialXp += taskCount;
		}
		return initialXp;
	}
}

class ResearcherSkillCalculator implements SkillCalculator {
	async calculateXp(plugin: NotescapePlugin): Promise<number> {
		let initialXp = 0;
		const files = plugin.app.vault.getMarkdownFiles();
		const uniqueTags = new Set<string>();

		for (const file of files) {
			const content = await plugin.getFileContent(file);
			const tags = (content.match(/#\w+/g) || []);
			tags.forEach(tag => uniqueTags.add(tag.toLowerCase()));
		}

		initialXp = uniqueTags.size * 1;
		return initialXp;
	}
}

const skillsData = new Map<string, { name: string, icon: string, description: string }>([
	["Scribe", { name: "Scribe", icon: "pencil", description: "XP based on words written in markdown files." }],
	["Archivist", { name: "Archivist", icon: "file-archive", description: "XP based on the number of markdown files." }],
	["Connector", { name: "Connector", icon: "link", description: "XP based on the number of Obsidian links created." }],
	["Hoarder", { name: "Hoarder", icon: "archive", description: "XP based on the total number of files." }],
	["Researcher", { name: "Researcher", icon: "search", description: "XP based on the number of unique tags used." }],
	["Curator", { name: "Curator", icon: "image", description: "XP based on the number of attachments or media added." }],
	["Taskmaster", { name: "Taskmaster", icon: "checkmark", description: "XP based on the number of tasks completed." }],
	["Total Level", { name: "Total Level", icon: "star", description: "Total level of all skills." }]
]);

export default class NotescapePlugin extends Plugin {
	settings: NotescapePluginSettings;
	skills: { [key: string]: Skill } = {};
	updateIntervalId: number;
	fileCache: Map<string, string> = new Map();

	async onload() {
		await this.loadSettings();

		this.initializeSkills();

		this.registerView(
			VIEW_TYPE_STATS,
			(leaf) => {
				const statsView = new StatsView(leaf, this);
				return statsView;
			}
		);

		this.addRibbonIcon("chart-no-axes-column", "Open Stats View", async () => {
			this.activateView();
		});

		this.addSettingTab(new NotescapeSettingTab(this.app, this));

		this.startPeriodicUpdates();

		this.app.workspace.onLayoutReady(() => {
			this.activateView();
		}
		);
	}

	async getFileContent(file: TFile): Promise<string> {
		if (this.fileCache.has(file.path)) {
			return this.fileCache.get(file.path) ?? "";
		}

		const content = await this.app.vault.read(file);
		this.fileCache.set(file.path, content);
		return content;
	}

	clearFileCache() {
		this.fileCache.clear();
	}

	async onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_STATS);
		clearInterval(this.updateIntervalId);
		this.clearFileCache();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	initializeSkills() {
		const savedSkills = this.settings.savedSkills || Object.fromEntries(
			Array.from(skillsData.entries()).map(([key, value]) => [key, { name: value.name, xp: 0, icon: value.icon }])
		);

		for (const key in savedSkills) {
			if (this.settings.savedSkills && this.settings.savedSkills[key]) {
				this.skills[key] = new Skill(this.settings.savedSkills[key]);
			} else {
				this.skills[key] = new Skill(savedSkills[key]);
			}
		}

		this.calculateTotalLevel();
	}

	startPeriodicUpdates() {
		this.updateIntervalId = window.setInterval(() => {
			this.updateSkills();
			this.saveSkills();
		}, this.settings.updateInterval * 60 * 1000);
	}

	async updateSkills() {
		await Promise.all([
			(async () => { this.skills["Scribe"].xp = await new ScribeSkillCalculator().calculateXp(this); })(),
			(async () => { this.skills["Archivist"].xp = await new ArchivistSkillCalculator().calculateXp(this); })(),
			(async () => { this.skills["Hoarder"].xp = await new HoarderSkillCalculator().calculateXp(this); })(),
			(async () => { this.skills["Curator"].xp = await new CuratorSkillCalculator().calculateXp(this); })(),
			(async () => { this.skills["Connector"].xp = await new ConnectorSkillCalculator().calculateXp(this); })(),
			(async () => { this.skills["Taskmaster"].xp = await new TaskmasterSkillCalculator().calculateXp(this); })(),
			(async () => { this.skills["Researcher"].xp = await new ResearcherSkillCalculator().calculateXp(this); })()
		]);

		for (const key in this.skills) {
			this.skills[key].updateLevel();
		}

		this.calculateTotalLevel();
		this.refreshStatsView();
	}

	async saveSkills() {
		const skillData: { [key: string]: SkillData } = {};
		for (const key in this.skills) {
			skillData[key] = { name: this.skills[key].name, xp: this.skills[key].xp, icon: this.skills[key].icon };
		}
		this.settings.savedSkills = skillData;
		await this.saveSettings();
	}

	refreshStatsView() {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS).forEach(leaf => {
			if (leaf.view instanceof StatsView) {
				leaf.view.onOpen();
			}
		});
	}

	async activateView() {
		const leftSplit = this.app.workspace.leftSplit;
		if (!leftSplit) {
			console.error("Notescape Plugin: Left sidebar split not found.");
			return;
		}
		leftSplit.expand();

		let statsLeaf: WorkspaceLeaf | null = null;
		this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS).forEach((leaf) => {
			if (leaf.getRoot() === leftSplit) {
				statsLeaf = leaf;
			}
		});

		if (statsLeaf) {
			this.app.workspace.revealLeaf(statsLeaf);
			return;
		}

		let fileExplorerLeaf: WorkspaceLeaf | null = null;
		this.app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.getRoot() === leftSplit && leaf.view?.getViewType() === 'file-explorer') {
				fileExplorerLeaf = leaf;
			}
		});

		let newLeaf: WorkspaceLeaf | null = null;
		if (fileExplorerLeaf) {
			newLeaf = this.app.workspace.createLeafBySplit(fileExplorerLeaf, 'horizontal');
		} else {
			console.warn("Notescape Plugin: File explorer leaf not found in the left sidebar. Opening in a new tab.");
			newLeaf = this.app.workspace.getLeftLeaf(false);
		}

		if (!newLeaf) {
			console.error("Notescape Plugin: Could not create or get leaf in the left sidebar.");
			return;
		}

		await newLeaf.setViewState({ type: VIEW_TYPE_STATS, active: true });
		this.app.workspace.revealLeaf(newLeaf);
	}

	calculateTotalLevel() {
		let totalLevel = 0;
		let skillCount = 0;
		for (const key in this.skills) {
			if (key !== "Total Level") {
				totalLevel += this.skills[key].level;
				skillCount++;
			}
		}

		if (this.skills["Total Level"]) {
			this.skills["Total Level"].xp = calculateXpForLevel(totalLevel);
			this.skills["Total Level"].updateLevel();
		}
	}
}

class StatsView extends ItemView {
	plugin: NotescapePlugin;

	constructor(leaf: WorkspaceLeaf, plugin: NotescapePlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType() {
		return VIEW_TYPE_STATS;
	}

	getDisplayText() {
		return "Notescape Stats";
	}

	getIcon() {
		return "chart-no-axes-column";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("notescape-stats-container");

		const skillsGrid = container.createDiv({ cls: "notescape-skills-grid" });

		for (const key in this.plugin.skills) {
			const skill = this.plugin.skills[key];
			const skillBox = skillsGrid.createDiv({ cls: "notescape-skill-box" });

			if (this.plugin.settings.showSkillNames) {
				skillBox.classList.add("show-names");
				skillBox.classList.remove("hide-names");
			} else {
				skillBox.classList.add("hide-names");
				skillBox.classList.remove("show-names");
			}

			const iconContainer = skillBox.createDiv({ cls: "notescape-skill-icon" });
			setIcon(iconContainer, skill.icon);

			const levelContainer = skillBox.createDiv({ cls: "notescape-skill-level" });
			levelContainer.createSpan({ text: `${skill.level}` });

			if (this.plugin.settings.showSkillNames) {
				skillBox.createDiv({ cls: "notescape-skill-name", text: skill.name });
			}

			const skillData = skillsData.get(skill.name);
			if (skillData) {
				skillBox.setAttr('title', `${skillData.name}\n${skillData.description}\nXP: ${skill.xp.toLocaleString()}`);
			} else {
				skillBox.setAttr('title', `${skill.name}\nXP: ${skill.xp.toLocaleString()}`);
			}
		}
	}

	async onClose() {
	}
}

class NotescapeSettingTab extends PluginSettingTab {
	plugin: NotescapePlugin;

	constructor(app: App, plugin: NotescapePlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Notescape Settings' });

		new Setting(containerEl)
			.setName('Show Skill Names')
			.setDesc('Toggle the display of skill names in the stats view.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showSkillNames)
				.onChange(async (value) => {
					this.plugin.settings.showSkillNames = value;
					await this.plugin.saveData(this.plugin.settings);
					this.plugin.refreshStatsView();
				}));

		new Setting(containerEl)
			.setName('Update Interval')
			.setDesc('Set the interval (in minutes) for updating skill levels.')
			.addText(text => text
				.setPlaceholder(String(DEFAULT_SETTINGS.updateInterval))
				.setValue(String(this.plugin.settings.updateInterval))
				.onChange(async (value) => {
					const parsedValue = parseInt(value);
					if (!isNaN(parsedValue) && parsedValue > 0) {
						this.plugin.settings.updateInterval = parsedValue;
						await this.plugin.saveSettings();
						clearInterval(this.plugin.updateIntervalId);
						this.plugin.startPeriodicUpdates();
					} else {
						this.plugin.settings.updateInterval = DEFAULT_SETTINGS.updateInterval;
						await this.plugin.saveSettings();
						clearInterval(this.plugin.updateIntervalId);
						this.plugin.startPeriodicUpdates();
					}
				}));
	}
}
