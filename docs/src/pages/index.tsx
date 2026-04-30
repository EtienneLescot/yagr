import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import styles from './index.module.css';

const features = [
  {
    eyebrow: 'Runtime',
    title: 'Local-first execution',
    text: 'Yagr runs the agent against real files, shell commands, provider configuration, sessions, and checkpoints.',
  },
  {
    eyebrow: 'Control',
    title: 'One agent, many surfaces',
    text: 'Use CLI, TUI, Web UI, or Telegram over the same runtime instead of splitting the product brain across interfaces.',
  },
  {
    eyebrow: 'Direction',
    title: 'Observable by design',
    text: 'The target Impact Ledger turns meaningful agent effects into a reviewable record beyond chat history.',
  },
];

export default function Home(): React.JSX.Element {
  return (
    <Layout
      title="Yagr"
      description="Yagr is your autonomous coding agent grounded in observable local reality."
    >
      <main className={styles.pageShell}>
        <section className={styles.heroSection}>
          <div className={styles.heroContent}>
            <div className={styles.acronymLockup} aria-label="YAGR means Your Agent Grounded in Reality">
              <span>Y</span>
              <span>A</span>
              <span>G</span>
              <span>R</span>
            </div>
            <p className={styles.heroBrandTag}>
              <span>Your</span>
              <span>Agent</span>
              <span>Grounded in</span>
              <span>Reality</span>
            </p>
            <h1>Autonomous coding without the black box.</h1>
            <p className={styles.heroLead}>
              Yagr is a local-first runtime for autonomous coding agents: real files,
              shell execution, provider-agnostic models, sessions, checkpoints, and
              control surfaces you can actually operate.
            </p>
            <div className={styles.heroPills} aria-label="Yagr core promises">
              <span>Local runtime</span>
              <span>Provider agnostic</span>
              <span>Observable impact</span>
            </div>
            <div className={styles.heroActions}>
              <Link className="button button--primary button--lg" to="/docs/">
                Read the docs
              </Link>
              <Link className="button button--secondary button--lg" to="/docs/concepts/grounded-in-reality">
                Why grounded matters
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.featureSection}>
          <div className={styles.featureGrid}>
            {features.map((feature) => (
              <article key={feature.title} className={styles.featureCard}>
                <p>{feature.eyebrow}</p>
                <h2>{feature.title}</h2>
                <p>{feature.text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>
    </Layout>
  );
}
