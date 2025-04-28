import { App, Plugin, WorkspaceLeaf, ItemView, WorkspaceSplit, setIcon, Setting, PluginSettingTab } from "obsidian";
import * as fs from 'fs';

const VIEW_TYPE_STATS = "notescape-stats-view";

// Settings interface
interface NotescapePluginSettings {
	showSkillNames: boolean;
}

// Default settings
const DEFAULT_SETTINGS: NotescapePluginSettings = {
	showSkillNames: true
}

// Temporary skill data structure
interface Skill {
	name: string;
	level: number;
	xp: number;
	icon: string;
}

const tempSkills: Skill[] = [
	// Scribe (Words Written)
	{ name: "Scribe", level: 5, xp: 500, icon: "pencil" },
	// Archivist (Files/Notes Created)
	{ name: "Archivist", level: 3, xp: 300, icon: "file-archive" },
	// Connector (Links Created)
	{ name: "Connector", level: 7, xp: 700, icon: "link" },
	// Hoarder (Everything Totaled)
	{ name: "Hoarder", level: 8, xp: 800, icon: "archive" },
	// Researcher (Unique Sources or Tags Used)
	{ name: "Researcher", level: 6, xp: 600, icon: "search" },
	// Curator (Attachments or Media Added)
	{ name: "Curator", level: 4, xp: 400, icon: "image" },
	// Taskmaster (Tasks Completed)
	{ name: "Taskmaster", level: 9, xp: 900, icon: "checkmark" },
	// Total (Overall Progress)
	{ name: "Total Level", level: 10, xp: 1000, icon: "star" },
];

class StatsView extends ItemView {
	constructor(leaf: WorkspaceLeaf) {
		super(leaf);
	}

	getViewType() {
		return VIEW_TYPE_STATS;
	}

	getDisplayText() {
		return "Notescape Stats";
	}

	// Add this method to set the icon
	getIcon() {
		return "chart-no-axes-column";
	}

	async onOpen() {
		const container = this.containerEl.children[1];
		container.empty();
		// Add a class for easier CSS targeting if needed elsewhere, though styles are self-contained here
		container.addClass("notescape-stats-container");

		// --- Grid Creation ---
		const skillsGrid = container.createDiv({ cls: "notescape-skills-grid" });

		tempSkills.forEach(skill => {
			const skillBox = skillsGrid.createDiv({ cls: "notescape-skill-box" });

			// Add or remove class based on settings
			if (this.plugin.settings.showSkillNames) {
				skillBox.classList.add("show-names");
				skillBox.classList.remove("hide-names");
			} else {
				skillBox.classList.add("hide-names");
				skillBox.classList.remove("show-names");
			}

			// Icon (using Obsidian icons)
			const iconContainer = skillBox.createDiv({ cls: "notescape-skill-icon" });
			setIcon(iconContainer, skill.icon); // Use Obsidian's setIcon function

			// Level/Level
			const levelContainer = skillBox.createDiv({ cls: "notescape-skill-level" });
			levelContainer.createSpan({ text: `${skill.level}` });
			//levelContainer.createSpan({ text: ` / ${skill.level}` }); // Displaying level/level

			// Name
			if (this.plugin.settings.showSkillNames) {
				skillBox.createDiv({ cls: "notescape-skill-name", text: skill.name });
			}

			// Optional: Tooltip on hover to show XP
			skillBox.setAttr('title', `${skill.name}\nXP: ${skill.xp.toLocaleString()}`);
		});

	}

	async onClose() {
		// Cleanup if needed
	}

	plugin: NotescapePlugin;
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

		new Setting(containerEl)
			.setName('Show Skill Names')
			.setDesc('Toggle the display of skill names in the stats view.')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.showSkillNames)
				.onChange(async (value) => {
					this.plugin.settings.showSkillNames = value;
					await this.plugin.saveData(this.plugin.settings);
					this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_STATS).forEach(leaf => {
						if (leaf.view instanceof StatsView) {
							leaf.view.onOpen(); // Refresh the view
						}
					});
				}));
	}
}


export default class NotescapePlugin extends Plugin {
	settings: NotescapePluginSettings;

	async onload() {
		await this.loadSettings();

		this.registerView(
			VIEW_TYPE_STATS,
			(leaf) => {
				const statsView = new StatsView(leaf);
				statsView.plugin = this; // Pass the plugin instance to the view
				return statsView;
			}
		);

		this.addRibbonIcon("chart-no-axes-column", "Open Stats View", async () => {
			const leftSplit = this.app.workspace.leftSplit;
			// Ensure the left sidebar is open
			if (!leftSplit) {
				console.error("Notescape Plugin: Left sidebar split not found.");
				return;
			}
			leftSplit.expand();

			// 1. Check if our view already exists in the left split
			let statsLeaf: WorkspaceLeaf | null = null;
			this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS).forEach((leaf) => {
				if (leaf.getRoot() === leftSplit) {
					statsLeaf = leaf;
				}
			});

			// If it exists, just reveal it
			if (statsLeaf) {
				this.app.workspace.revealLeaf(statsLeaf);
				return;
			}

			// 2. If not, find the file explorer leaf to split
			let fileExplorerLeaf: WorkspaceLeaf | null = null;
			// Iterate directly through the leaves in the left split
			this.app.workspace.iterateAllLeaves((leaf) => {
				if (leaf.getRoot() === leftSplit && leaf.view?.getViewType() === 'file-explorer') {
					fileExplorerLeaf = leaf;
				}
			});

			let newLeaf: WorkspaceLeaf | null = null;
			if (fileExplorerLeaf) {
				// 3a. Split the file explorer leaf horizontally (top/bottom)
				newLeaf = this.app.workspace.createLeafBySplit(fileExplorerLeaf, 'horizontal'); // Changed 'vertical' to 'horizontal'
			} else {
				// 3b. Fallback: Create a new leaf in the left sidebar (new tab)
				console.warn("Notescape Plugin: File explorer leaf not found in the left sidebar. Opening in a new tab.");
				newLeaf = this.app.workspace.getLeftLeaf(false);
			}

			// 4. Ensure leaf exists and set state
			if (!newLeaf) {
				console.error("Notescape Plugin: Could not create or get leaf in the left sidebar.");
				return;
			}

			await newLeaf.setViewState({ type: VIEW_TYPE_STATS, active: true });
			this.app.workspace.revealLeaf(newLeaf);
		});

		// Add settings tab
		this.addSettingTab(new NotescapeSettingTab(this.app, this));
	}

	async onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_STATS);
		this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS).forEach(leaf => {
			leaf.detach();
		});
		this.app.workspace.onLayoutReady(() => {
			this.app.workspace.getLeavesOfType(VIEW_TYPE_STATS).forEach(leaf => {
				leaf.detach();
			});
		});
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}
