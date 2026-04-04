# Target Backlog

Cette section est ephemere.

Elle doit contenir uniquement le travail restant pour converger vers une architecture propre et stable.
Tout ce qui est deja implemente doit etre documente dans `../current/`, pas ici.

## Restant a faire

La direction cible de reference est documentee dans `yagr-engine-architecture.md`.

### Exposition des instances N8N via Tunnel Cloudflare

Spec detaillee : `n8n-cloudflare-tunnel-exposure.md`

- Creer `n8n-local/n8n-tunnel.ts` : module `N8nTunnelManager` (start / stop / refresh / status), persistance dans `YAGR_HOME/n8n-tunnel.json`
- Ajouter `N8nTunnelConfig` dans `config/yagr-config-service.ts`
- Ajouter `setupN8nTunnel()` dans `setup/application-services.ts`, resolution de `targetUrl` selon les 4 figures d'instance (managed/externe x direct/Docker)
- Exposer les commandes LLM + CLI : `n8n tunnel start|stop|refresh|status|url`
- Modifier `gateway/workflow-links.ts` pour substituer l'URL n8n par l'URL tunnel publique quand active
- Injecter l'URL tunnel publique dans le prompt systeme quand active
- Gerer la propagation de `N8N_WEBHOOK_URL` au demarrage n8n (instances managed uniquement), et proposer un redemarrage explicite apres refresh
- Etape optionnelle dans le Setup Wizard : "Exposer N8N via tunnel"
- Batterie de tests : unit mock cloudflared, unit resolution targetUrl, unit workflow-links, integration Linux CI

- Renommer et recadrer `holon` en `Yagr Engine`
- Formaliser un IR canonique distinct des backends cibles
- Integrer l'UI graphe AI-native de `Yagr Engine` dans les surfaces `Yagr`
- Faire de `Hatchet` le runtime du chemin `Yagr Engine`
- Formaliser le choix backend amont `n8n` vs `Yagr Engine + Hatchet`
- Extraire progressivement le couplage `n8n` encore present dans le prompt, le tooling et les flux de run
- Unifier les edits chat et UI autour du meme pipeline de patch/validation `Yagr Engine`

## Regle de vie

- Quand un item est termine, il est retire de cette page.
- Quand une nouvelle realite architecturale existe, elle est documentee dans `../current/`.
- `target/` doit rester minimal; si tout est converge, ce fichier ne comporte plus de todo.
