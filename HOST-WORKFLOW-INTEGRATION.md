# Workflow API host integration

Target: SDK 0.1.8 / host protocol 0.1.6. Audience: NoteGen and SDK maintainers.

## Boundaries

The SDK owns public contracts, manifest validation, portable helpers and test doubles. NoteGen owns authoritative permission checks, application data, provider credentials and host-rendered UI. Community workers forward RPC requests; they cannot access the database, React tree or model configuration directly.

The broker checks plugin lifecycle, current workspace authorization and the required grant. Record reads recheck grants before returning data. Writes check immediately before the database operation; updates additionally compare the complete original row in SQL. A successful write cannot be undone by subsequent cancellation. Clients should re-read after an uncertain result rather than blindly repeating mutations.

Records use application scope; frontend, native package validation and permission labels must agree. The main-window bridge alone offers records, drafts, AI and prompts. Separate editor windows report no new capabilities and reject these RPCs.

## Lifecycle

Embedded views carry an opaque mount/context token; offscreen or replaced contexts cannot receive stale updates. The SDK renderer helper cancels superseded work and echoes the token. Host UI content remains declarative and all action commands stay namespace checked.

Prompts share the single plugin-dialog slot. The host resolves only the active prompt ID, validates selected values, and clears pending prompts on plugin shutdown. Command/activation timers defer failure while that plugin owns a prompt; other resource quotas still apply.

AI requests are reserved by plugin and request ID before asynchronous initialization. Ownership is tied to the runtime abort signal, preventing an obsolete runtime from cancelling its replacement. Disable, shutdown, timeout or explicit cancellation aborts the provider request. Only explicit plugin prompts are sent; existing chat history, tools and credentials are excluded from RPC responses. Streaming events contain accumulated text.

Record events include tag changes. Delivery rechecks authorization and runtime ownership. Subscriptions are disposed with the plugin. The task queue is SDK-local and does not represent persistent host scheduling.

## Coordinated release

1. Review the shared SDK changes, including embedded views and Kanban/source handoff, as one 0.1.8 release with protocol metadata 0.1.6.
2. After permission to run release checks, validate and publish through the existing npm workflow. It runs `pnpm test` and package builds; do not publish stale `dist` files or bypass immutable archive verification.
3. Once the npm packages exist, update NoteGen's registry dependency and lockfile to SDK 0.1.8. Never replace them with a local path, workspace link or vendor copy.
4. Validate the matching host and update the reviewed host reference used by the SDK host-contract workflow. An old host reference is not evidence that new source contracts match.
5. Publish host-facing documentation and release notes against an actually released app version. Installing the SDK alone does not make new host methods available.

SDK validation: all four packages build successfully and all 22 contract tests pass. Host integration must still be validated against the published npm package after step 3. The SDK result alone does not establish native or UI acceptance.
