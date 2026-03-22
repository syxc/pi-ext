# pi-ext

Collection of extensions for [pi coding agent](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent).

## Extensions

### file-sentry

File operation permission system for Read/Write/Edit tools.

> Works best with [pi-amplike](https://github.com/pasky/pi-amplike) — complements its Bash permission system.

**Usage**:
```bash
/file-sentry yolo      # Allow all operations
/file-sentry enable    # Enable permission checks
/file-sentry status    # Show current mode
```

**Install**: Copy `extensions/file-sentry.ts` and add to `~/.pi/agent/settings.json`:
```json
{ "extensions": ["~/.pi/agent/extensions/file-sentry.ts"] }
```

See [extensions/file-sentry.ts](extensions/file-sentry.ts) for full docs.

## License

MIT
