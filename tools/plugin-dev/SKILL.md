---
name: hghub-plugin-dev
description: Develop and validate standalone JavaScript content-source or resolver plugins for HGhub HPP. Use for capabilities, host API integration, manifests and plugin debugging, not for changing the application UI.
---

# HGhub plugin development

Read references/status.md first: the public protocol is a design contract while the development host still has gaps. Read references/quickstart.md for workflow and references/protocol/README.md for the protocol map. Use assets/protocol.ts for shapes and assets/plugin-hello.js as a fictional example.

Use the site and output directory from the user's request. Inspect actual pages and requests before selecting capabilities. Keep site URLs, transformations and credentials inside the plugin, not the host. Never embed observed user session credentials in distributed source.

Deliver one self-contained UTF-8 ES module with meta and a default factory. Only declare capabilities the site supports. Use hg.http for APIs, resource objects for images/media and hg.storage for state needed after runtime reload. Factories construct objects and read settings without I/O.

Preserve upstream media, playlist, episode, category and server IDs. List position is not identity. Encode pagination state in returned cursors, not closure state. Respect ctx cancellation and do not schedule background work.

Check features or method presence for optional behavior. Put indispensable APIs in meta.requires. Do not claim RSA, WebView, DASH, download or platform playback support from a type declaration alone.

Map user-facing failures to hg.PluginError; distinguish upstream rejection from changed successful response shapes. Keep logs free of credentials and signed URLs.

Read references/testing.md and references/distribution.md before delivery. Verify file import, manifest identity/version, selected install, repeat import, detail and playback. Distinguish synthetic tests, real QuickJS, upstream requests and native device playback evidence. Report unverified behavior and retain reproduction steps.

Follow publication constraints. Creating a plugin or manifest does not authorize uploading it. Public examples use fictional or user-controlled services.
