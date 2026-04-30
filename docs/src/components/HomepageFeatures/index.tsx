import React from 'react';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: 'Grounded Runtime',
    description: 'Run autonomous coding against real files, shell commands, sessions, checkpoints, and project instructions.',
  },
  {
    title: 'Provider Freedom',
    description: 'Configure API-key and account-backed model providers through one local runtime boundary.',
  },
  {
    title: 'Thin Surfaces',
    description: 'Use CLI, TUI, Web UI, and Telegram over the same agent, sessions, and checkpoints.',
  },
];

export default function HomepageFeatures(): React.JSX.Element {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props) => (
            <div className="col col--4" key={props.title}>
              <div className="text--center padding-horiz--md">
                <Heading as="h3">{props.title}</Heading>
                <p>{props.description}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
