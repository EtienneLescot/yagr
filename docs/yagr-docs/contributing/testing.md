# Testing

Use the standard checks before publishing changes:

```bash
pnpm run typecheck
pnpm run build
pnpm run test:packages
pnpm run test:unit
```

Provider-specific smoke tests can be added around the provider runtime without requiring any built-in domain backend.
