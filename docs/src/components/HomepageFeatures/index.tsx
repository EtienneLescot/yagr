import React from 'react';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

const FeatureList = [
  {
    title: 'Local Coding Agent',
    description: 'Inspect, edit, and validate local repositories through a deepagents-based runtime.',
  },
  {
    title: 'Provider Runtime',
    description: 'Configure API-key and account-backed model providers through one local runtime.',
  },
  {
    title: 'Thin Surfaces',
    description: 'Use CLI, Web UI, and Telegram surfaces over the same sessions and checkpoints.',
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
