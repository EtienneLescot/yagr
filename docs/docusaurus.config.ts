import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Yagr',
  tagline: '(Y)our (A)gent (G)rounded in (R)eality',
  favicon: 'img/favicon.ico',


  // Set the production url of your site here
  url: 'https://n8nascode.dev',
  // Custom domains are served from the site root on GitHub Pages.
  baseUrl: '/',

  // GitHub pages deployment config.
  // If you aren't using GitHub pages, you don't need these.
  organizationName: 'EtienneLescot',
  projectName: 'n8n-as-code',
  trailingSlash: true,

  onBrokenLinks: 'warn',
  markdown: {
    hooks: {
      onBrokenMarkdownLinks: (args) => {
        console.warn(`Broken markdown link found: ${args.url} in ${args.sourceFilePath}`);
      },
    },
  },

  // Even if you don't use internationalization, you can use this field to set
  // useful metadata like html lang. For example, if your site is Chinese, you
  // may want to replace "en" with "zh-Hans".
  i18n: {
    defaultLocale: 'en',
    locales: ['en'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: 'docs',
          sidebarPath: './sidebars.ts',
          editUrl: 'https://github.com/EtienneLescot/n8n-as-code/tree/main/docs/',
          showLastUpdateAuthor: true,
          showLastUpdateTime: true,
          routeBasePath: '/docs',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themes: [
    '@docusaurus/theme-mermaid',
    [
      require.resolve('@easyops-cn/docusaurus-search-local'),
      {
        hashed: true,
        indexDocs: true,
        indexBlog: false,
        indexPages: false,
        language: ['en'],
        highlightSearchTermsOnTargetPage: true,
        explicitSearchResultPath: true,
        docsRouteBasePath: ['/docs', '/yagr/docs'],
      },
    ],
  ],

  plugins: [
    [
      '@docusaurus/plugin-content-docs',
      {
        id: 'yagr',
        path: 'yagr-docs',
        routeBasePath: 'yagr/docs',
        sidebarPath: './sidebars.yagr.ts',
        editUrl: 'https://github.com/EtienneLescot/n8n-as-code/tree/main/docs/',
        showLastUpdateAuthor: true,
        showLastUpdateTime: true,
        breadcrumbs: true,
      },
    ],
    // Temporarily disabled API plugin due to TypeDoc markdown ID issues
    // [
    //   '@docusaurus/plugin-content-docs',
    //   {
    //     id: 'api',
    //     path: 'static/api',
    //     routeBasePath: 'api',
    //     sidebarPath: './sidebars.api.ts',
    //     editUrl: 'https://github.com/EtienneLescot/n8n-as-code/tree/main/',
    //     showLastUpdateAuthor: true,
    //     showLastUpdateTime: true,
    //     breadcrumbs: true,
    //   },
    // ],
  ],

  themeConfig: {
    // Replace with your project's social card
    image: 'img/og-image.png',
    colorMode: {
      defaultMode: 'dark',
      disableSwitch: false,
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: 'Yagr',
      logo: {
        alt: 'Yagr Logo',
        src: 'img/yagr-logo.png',
      },
      items: [
        {
          to: '/yagr/docs/getting-started',
          position: 'left',
          label: 'Yagr Docs',
        },
        {
          to: '/n8n-as-code',
          position: 'left',
          label: 'n8n-as-code',
        },
        {
          to: '/docs/getting-started',
          position: 'left',
          label: 'n8n-as-code Docs',
        },
        {
          href: 'https://github.com/EtienneLescot/n8n-as-code',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: 'Documentation',
          items: [
            {
              label: 'Yagr Docs',
              to: '/yagr/docs',
            },
            {
              label: 'n8n-as-code Docs',
              to: '/docs/getting-started',
            },
          ],
        },
        {
          title: 'Products',
          items: [
            {
              label: 'Yagr',
              to: '/yagr/docs',
            },
            {
              label: 'n8n-as-code',
              to: '/n8n-as-code',
            },
            {
              label: 'VS Code Extension',
              href: 'https://marketplace.visualstudio.com/items?itemName=etienne-lescot.n8n-as-code',
            },
          ],
        },
        {
          title: 'Community',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/EtienneLescot/n8n-as-code',
            },
            {
              label: 'Discussions',
              href: 'https://github.com/EtienneLescot/n8n-as-code/discussions',
            },
            {
              label: 'Issues',
              href: 'https://github.com/EtienneLescot/n8n-as-code/issues',
            }
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} Yagr and n8n-as-code. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
      additionalLanguages: ['bash', 'json', 'typescript'],
    },
    docs: {
      sidebar: {
        hideable: true,
        autoCollapseCategories: true,
      },
    },
    breadcrumbs: true,
    // Algolia search disabled - not configured yet
    // algolia: {
    //   appId: 'YOUR_APP_ID',
    //   apiKey: 'YOUR_SEARCH_API_KEY',
    //   indexName: 'n8n-as-code',
    //   contextualSearch: true,
    // },
    metadata: [
      { name: 'keywords', content: 'yagr, n8n-as-code, automation, ai agent, telegram, tui, workflow, gitops' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  } satisfies Preset.ThemeConfig,
};

export default config;
