import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  yagr: [
    {
      type: 'doc',
      id: 'index',
      label: 'Overview',
    },
    {
      type: 'doc',
      id: 'getting-started/index',
      label: 'Getting Started',
    },
    {
      type: 'category',
      label: 'Usage',
      link: {
        type: 'doc',
        id: 'usage/index',
      },
      items: [
        'usage/skills',
        'usage/telegram',
        'usage/tui',
      ],
    },
    {
      type: 'doc',
      id: 'reference/commands',
      label: 'Commands',
    },
    {
      type: 'category',
      label: 'Contributing',
      link: {
        type: 'doc',
        id: 'contributing/index',
      },
      items: [
        'contributing/testing',
      ],
    },
  ],
};

export default sidebars;
