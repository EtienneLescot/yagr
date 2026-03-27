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
        'usage/webui',
        'usage/telegram',
        'usage/tui',
        'usage/n8n-backend',
      ],
    },
    {
      type: 'doc',
      id: 'reference/commands',
      label: 'Commands',
    },
  ],
};

export default sidebars;