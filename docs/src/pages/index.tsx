import React from 'react';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import styles from './index.module.css';

const features = [
  {
    title: 'Local coding runtime',
    text: 'Yagr runs as an autonomous coding agent over your local files, shell, sessions, and model provider configuration.',
  },
  {
    title: 'Thin surfaces',
    text: 'Use the CLI, Web UI, or Telegram gateway over the same runtime and session model.',
  },
  {
    title: 'Domain-agnostic core',
    text: 'External tools are ordinary project dependencies, not built-in product coupling.',
  },
];

export default function Home(): React.JSX.Element {
  return (
    <Layout
      title="Yagr"
      description="Autonomous local coding agent"
    >
      <main className={styles.pageShell}>
        <section className={styles.heroSection}>
          <div className={styles.heroContent}>
            <p className={styles.heroBrandTag}>Autonomous local coding agent</p>
            <h1>Yagr helps you inspect, edit, and validate local codebases.</h1>
            <p className={styles.heroLead}>
              A deepagents-based runtime with provider setup, sessions, checkpoints, and thin surfaces for local coding work.
            </p>
            <div className={styles.heroActions}>
              <Link className="button button--primary button--lg" to="/docs/">
                Read the docs
              </Link>
              <Link className="button button--secondary button--lg" to="/docs/usage/">
                Start using Yagr
              </Link>
            </div>
          </div>
        </section>

        <section className={styles.featureSection}>
          <div className={styles.featureGrid}>
            {features.map((feature) => (
              <article key={feature.title} className={styles.featureCard}>
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
