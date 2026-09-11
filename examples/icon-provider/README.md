# Runtime icon provider

A minimal example of context.fileIcons.setRules(). Rules replace this plugin’s earlier runtime rules, take precedence over its manifest rules, and disappear when its runtime stops. It declares both workspace and editor activation so separate editor windows receive the same rules. Use context.fileIcons.clear() to restore its manifest rules. File paths are exact locations; a moved file is resolved using its new path, not its old cached icon.
