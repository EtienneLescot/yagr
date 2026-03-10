import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  image: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'Explicit Git-like Workflow',
    image: require('@site/static/img/sections/section-0.png').default,
    description: (
      <>
        List current status, pull the workflow you want, edit locally, then push a specific
        filename back to n8n. Clear operations beat hidden background behavior.
      </>
    ),
  },
  {
    title: 'AI Skill With Real Context',
    image: require('@site/static/img/sections/section-1.png').default,
    description: (
      <>
        Empower AI agents with schema-accurate node data, documentation, validation, and thousands
        of workflow examples packaged for fast local search.
      </>
    ),
  },
  {
    title: 'TypeScript Workflows',
    image: require('@site/static/img/sections/section-2.png').default,
    description: (
      <>
        Convert workflows into readable decorators and stable diffs so humans and coding agents can
        reason about automation as code instead of opaque JSON blobs.
      </>
    ),
  },
  {
    title: 'Canvas Preview in VS Code',
    image: require('@site/static/img/sections/section-3.png').default,
    description: (
      <>
        Edit in code while keeping the n8n canvas close. The IDE becomes the place where review,
        validation, preview, and sync decisions happen together.
      </>
    ),
  },
  {
    title: 'Deterministic Conflict Resolution',
    image: require('@site/static/img/sections/section-4.png').default,
    description: (
      <>
        Three-way comparison detects real conflicts, avoids false positives, and keeps resolution
        visible through diffs and explicit keep-local or keep-remote actions.
      </>
    ),
  },
  {
    title: 'Project-aware Local Structure',
    image: require('@site/static/img/sections/section-5.png').default,
    description: (
      <>
        Keep instances and projects separated on disk so teams can version the right workflows
        without cross-environment confusion.
      </>
    ),
  },
];

function Feature({title, image, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className={styles.featureCard}>
        <div className={styles.featureMedia}>
          <img
            src={image}
            className={styles.featureImage}
            alt={title}
          />
        </div>
        <div className={styles.featureBody}>
          <Heading as="h3">{title}</Heading>
          <p>{description}</p>
        </div>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className={styles.header}>
          <p className={styles.eyebrow}>What the stack gives your agent and your team</p>
          <Heading as="h2">A workflow system designed for AI execution and human review.</Heading>
        </div>
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
