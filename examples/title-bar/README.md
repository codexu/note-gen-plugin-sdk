# Title bar components

Requires SDK 0.1.5 and the NoteGen host implementing protocol 0.1.3.

Build with `notegen-plugin build examples/title-bar` from the SDK repository,
then import `examples/title-bar/.notegen/package` in NoteGen developer mode.

The example adds a left icon button after the recording controls, a centered
workspace label and badge, and a right button before the built-in controls.
Both buttons show a notice. Display settings can hide each slot independently.

Use `context.ui.views.close(id)` / `open(id)` to hide / restore an item, and
`update(id, document)` to change its content. A document with forms, lists or
other larger blocks opens from a title/icon button in a popover.

Manual acceptance: inspect all three positions on macOS and Windows/Linux;
click both buttons, drag using the remaining blank title bar, resize the window,
hide/show slots, close/open views, and disable/re-enable the plugin. Confirm
window controls remain reachable and no components remain after disabling.
