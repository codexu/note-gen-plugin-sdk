# 插件交互实验室

仅在隔离的 NoteGen 测试应用和工作区使用，不要导入生产工作区。

在 SDK 仓库根目录构建：

```bash
node packages/plugin-cli/dist/bin.js build examples/interaction-lab --app-version 0.37.0
```

开启测试应用的开发者模式，导入 `examples/interaction-lab/.notegen/package` 的绝对路径。
四项笔记权限均只填写 `PluginLab`，启用后通过插件命令面板运行“打开交互实验室”。

- 表单：一个字符的标题应被拒绝；两个以上字符应保存。隐藏备注不应提交。重启插件后保留标题。
- 弹窗：填写确认内容后提交，应更新面板并关闭弹窗。
- 文件：创建按钮只创建 `PluginLab/fixture.md`，不会覆盖已有文件，也不会打开编辑器。
- 写入：追加前读取 revision；“验证冲突保护”先追加标记，再确认旧 revision 无法覆盖内容。
- 删除：仅将上述固定文件移入桌面系统废纸篓。应能通过系统废纸篓找回；不要清空废纸篓。
- 如果笔记在任意编辑器中打开，文件修改应被拒绝；请先关闭对应标签。

此示例是手动验收工具，不代表已通过所有平台的完整验收。
