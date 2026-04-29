import type {ReactNode} from 'react';
import clsx from 'clsx';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import useBaseUrl from '@docusaurus/useBaseUrl';
import Layout from '@theme/Layout';
import Heading from '@theme/Heading';

import styles from './index.module.css';

const productPillars = [
  'Core runtime',
  'Shared surfaces',
  'Plugins and apps',
];

const proofPoints = [
  {
    icon: '🧭',
    value: 'Intent first',
    label: 'Runtime before product-specific glue',
    detail: 'Yagr is becoming a reusable runtime platform instead of remaining only a single assembled app.',
  },
  {
    icon: '🧩',
    value: 'Facades matter',
    label: 'Consumers should depend on facades, not internals',
    detail: 'Products such as Axcut should prefer @yagr/runtime and @yagr/surfaces instead of many tiny internal packages.',
  },
  {
    icon: '🧠',
    value: 'Core stays agnostic',
    label: 'External managers do not define the agent',
    detail: 'Manager-specific behavior now lives outside this repository; Yagr keeps the runtime and surfaces focused on the agent.',
  },
  {
    icon: '🏠',
    value: 'Sessions stay durable',
    label: 'Session/checkpoint/runtime state remain first-class',
    detail: 'The platform split keeps sessions, checkpoints, stream state, and events reusable across products and surfaces.',
  },
  {
    icon: '💬',
    value: 'Surfaces stay thin',
    label: 'WebUI and TUI are reusable rendering layers',
    detail: 'The rendering logic is being extracted into shared surface packages so apps can compose them instead of duplicating them.',
  },
  {
    icon: '⚙️',
    value: 'Apps compose',
    label: 'The current agent app is now one consumer of the platform',
    detail: 'The repository is shifting from one app with helpers to a platform with apps, facades, and plugins layered above it.',
  },
];

const entryPoints = [
  {
    title: 'For automation intent',
    text: 'Start from what you want to automate, not from raw node wiring. Yagr should be the product layer that translates that intent.',
    link: '/docs/getting-started',
    cta: 'Read the Yagr starting point',
  },
  {
    title: 'For remote interaction',
    text: 'Use Telegram as one gateway into the same agent loop, with setup-managed credentials, onboarding links, and linked chats.',
    link: '/docs/usage/telegram',
    cta: 'See the Telegram flow',
  },
  {
    title: 'For workflow engineering',
    text: 'n8n-as-code remains a product in its own right for workflow GitOps, AI skills, schema grounding, and TypeScript workflows.',
    link: 'https://n8nascode.dev',
    cta: 'Open the n8n-as-code product page',
  },
];

const workflowSteps = [
  {label: '1', title: 'Express intent', text: 'Start with the automation you want, in natural language, instead of manually assembling raw implementation primitives.'},
  {label: '2', title: 'Ground in the engine', text: 'Yagr uses the node and schema knowledge of the current backend so generation stays anchored to real capabilities.'},
  {label: '3', title: 'Generate and validate', text: 'The agent produces workflows against the execution engine rather than embedding its own brain into the runtime.'},
  {label: '4', title: 'Persist as memory', text: 'The resulting workflow becomes durable executable memory that Yagr can revisit, explain, and evolve later.'},
  {label: '5', title: 'Operate through surfaces', text: 'TUI, Telegram, and the local interfaces remain thin surfaces over the same agent and n8n execution layer.'},
];

const quickStartSteps = [
  {
    label: 'Install',
    text: 'Two commands. No n8n pre-installed, no API key hunting.',
  },
  {
    label: 'Onboard',
    text: 'A guided TUI wizard handles n8n, model credentials, and integrations. Docker spins up automatically.',
  },
  {
    label: 'Start',
    text: 'Run `yagr start` then prompt naturally — Yagr builds, publishes, and runs the workflow.',
  },
];

function HomepageHeader() {
  const yagrLogoUrl = useBaseUrl('/img/yagr-logo.png');

  return (
    <header className={clsx('hero hero--primary', styles.heroBanner, styles.yagrHeroBanner)}>
      <div className="container">
        <div className={styles.heroGrid}>
          <div className={styles.heroCopy}>
            <div className={styles.heroBrand}>
              <img src={yagrLogoUrl} alt="Yagr logo" className={styles.heroLogo} />
              <div>
                <div className={styles.heroBrandName}>Yagr</div>
                <div className={styles.heroBrandTag}>Autonomous agent · deterministic workflows · orchestrator-ready</div>
              </div>
            </div>
            <Heading as="h1" className={styles.heroTitle}>
              <span className={styles.heroLine}>(Y)our</span>
              <span className={styles.heroLine}>(A)gent</span>
              <span className={clsx(styles.heroLine, styles.heroAccent)}>(G)rounded in</span>
              <span className={clsx(styles.heroLine, styles.heroAccent)}>(R)eality.</span>
            </Heading>
            <p className={styles.heroSubtitle}>
              Most agents disappear into ephemeral scripts and blind API calls. Yagr takes the opposite path: it uses
              chat as the interface, but architects, validates, and deploys deterministic workflows underneath so the
              result stays auditable, inspectable, and durable.
            </p>
            <div className={styles.heroPills}>
              {productPillars.map((pillar) => (
                <span key={pillar} className={styles.heroPill}>
                  {pillar}
                </span>
              ))}
            </div>
            <div className={styles.buttons}>
              <Link
                className={clsx('button button--lg', styles.primaryButton)}
                to="/docs/getting-started">
                Start with Yagr
              </Link>
              <Link
                className={clsx('button button--lg', styles.secondaryButton)}
                to="https://n8nascode.dev">
                Explore n8n-as-code
              </Link>
            </div>
          </div>

          <div className={styles.heroPanel}>
            <div className={styles.panelWindow}>
              <div className={styles.panelDots}>
                <span />
                <span />
                <span />
              </div>
              <div className={styles.panelLabel}>Agent loop</div>
                <pre className={styles.commandBlock}>
                <code>{`$ npm install -g @yagr/agent@latest
$ yagr onboard
→ guided wizard, zero friction
→ autologin link to n8n canvas
$ yagr start`}</code>
              </pre>
              <div className={styles.panelCardGrid}>
                <div className={styles.panelCard}>
                  <span className={styles.cardKicker}>Intent</span>
                  <strong>Start from what to automate</strong>
                  <p>Yagr should begin from the user goal, not from manually wiring raw nodes and scripts.</p>
                </div>
                <div className={styles.panelCard}>
                  <span className={styles.cardKicker}>Reliability</span>
                  <strong>No blind script sprawl</strong>
                  <p>Yagr should not solve tasks by dropping opaque one-off scripts that nobody can audit tomorrow.</p>
                </div>
                <div className={styles.panelCard}>
                  <span className={styles.cardKicker}>Memory</span>
                  <strong>Workflows are memory and muscle</strong>
                  <p>Generated automations persist intent and execute it repeatedly as durable infrastructure.</p>
                </div>
                <div className={styles.panelCard}>
                  <span className={styles.cardKicker}>Engine</span>
                  <strong>n8n is the current orchestrator</strong>
                  <p>n8n sits underneath the agent so the product layer stays focused on user intent while execution remains visible in the canvas.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

export default function Home(): ReactNode {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} - ${siteConfig.tagline}`}
      description="Yagr is your autonomous agent, grounded in reliable infrastructure: deterministic workflows underneath the chat surface instead of ephemeral scripts and blind API calls.">
      <HomepageHeader />
      <main className={styles.yagrHome}>
        <section className={styles.quickStartSection}>
          <div className="container">
            <div className={styles.quickStartShell}>
              <div className={styles.quickStartIntro}>
                <p className={styles.sectionEyebrow}>Quick Start</p>
                <Heading as="h2" className={styles.sectionTitle}>
                  Get Yagr running before you read the manifesto.
                </Heading>
                <p className={styles.sectionLead}>
                  If your first question is “how do I try it?”, the answer should be immediate: install the CLI,
                  run onboarding once, then start the agent.
                </p>
                <div className={styles.quickStartCards}>
                  {quickStartSteps.map((step, index) => (
                    <div key={step.label} className={styles.quickStartCard}>
                      <span>{String(index + 1).padStart(2, '0')}</span>
                      <strong>{step.label}</strong>
                      <p>{step.text}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div className={styles.quickStartTerminal}>
                <div className={styles.quickStartTerminalBar} aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
                <pre className={styles.quickStartCode}>
                  <code>{`npm install -g @yagr/agent
yagr onboard  # guided TUI wizard
yagr start    # prompt-to-execution`}</code>
                </pre>
                <p className={styles.quickStartNote}>
                  Install the CLI, run the onboarding once, then start the local agent runtime from its own home.
                </p>
                <div className={styles.quickStartActions}>
                  <Link
                    className={clsx('button button--lg', styles.primaryButton)}
                    to="/docs/getting-started">
                    Open the getting started guide
                  </Link>
                  <Link className={styles.inlineLink} to="/docs/reference/commands">
                    See all CLI commands
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className={styles.proofSection}>
          <div className="container">
            <div className={styles.proofHeader}>
              <p className={styles.sectionEyebrow}>Why Yagr exists</p>
              <Heading as="h2" className={styles.sectionTitle}>
                Magic chat for users. Reliable systems for engineers.
              </Heading>
              <p className={styles.sectionLead}>
                Yagr matters because autonomous behavior should not require opaque one-off scripts. The chat interface
                can feel magical, while the actual execution remains deterministic, inspectable, and built on strict
                workflow ontology.
              </p>
            </div>
            <div className={styles.statsGrid}>
              {proofPoints.map((item) => (
                <div key={item.label} className={styles.statCard}>
                  <div className={styles.statTop}>
                    <span className={styles.statIcon}>{item.icon}</span>
                    <strong>{item.value}</strong>
                  </div>
                  <div className={styles.statLabel}>{item.label}</div>
                  <p className={styles.statDetail}>{item.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.entrySection}>
          <div className="container">
            <div className={styles.entryHeader}>
              <p className={styles.sectionEyebrow}>How the repository is now organized</p>
              <Heading as="h2" className={styles.sectionTitle}>
                Yagr as the agent product, <span className={styles.noWrap}>n8n-as-code</span> as the engineering substrate.
              </Heading>
            </div>
            <div className={styles.entryGrid}>
              {entryPoints.map((entry) => (
                <div key={entry.title} className={styles.entryCard}>
                  <h3>{entry.title}</h3>
                  <p>{entry.text}</p>
                  <Link className={styles.inlineLink} to={entry.link}>
                    {entry.cta}
                  </Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className={styles.workflowSection}>
          <div className="container">
            <div className={styles.workflowLayout}>
              <div>
                <p className={styles.sectionEyebrow}>How the loop works</p>
                <Heading as="h2" className={styles.sectionTitle}>
                  Intent, engine, workflow, memory.
                </Heading>
                <p className={styles.sectionLead}>
                  Yagr is intentionally narrower than a generic assistant and intentionally higher-level than the
                  workflow engineering stack. It sits in the middle: above the execution engine, below the user-facing
                  intent, and connected to durable workflow artifacts it can evolve over time.
                </p>
              </div>
              <div className={styles.workflowStack}>
                {workflowSteps.map((step) => (
                  <div key={step.label} className={styles.workflowCard}>
                    <span>{step.label}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className={styles.ctaSection}>
          <div className="container">
            <div className={styles.ctaCard}>
              <p className={styles.sectionEyebrow}>Start here</p>
              <Heading as="h2" className={styles.ctaTitle}>
                Start from the Yagr vision, then drop to the layer you need.
              </Heading>
              <p className={styles.ctaLead}>
                Use Yagr if you want the agent product that turns intent into automation. Use n8n-as-code if you want
                direct workflow GitOps, AI skill, VS Code extension, and TypeScript tooling.
              </p>
              <div className={styles.buttons}>
                <Link
                  className={clsx('button button--lg', styles.primaryButton)}
                  to="/docs/getting-started">
                  Read the Yagr guide
                </Link>
                <Link
                  className={clsx('button button--lg', styles.ghostButton)}
                  href="https://n8nascode.dev">
                  Open n8n-as-code
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </Layout>
  );
}
