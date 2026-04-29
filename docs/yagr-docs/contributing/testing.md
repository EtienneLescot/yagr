# Testing

Use the standard checks before publishing changes:

```bash
npm run typecheck
npm run build
npm run test:packages
npm run test:unit
```

Provider-specific smoke tests can be added around the provider runtime without requiring any built-in domain backend.
