import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: 'Studyflow Modeler',
  staticDirectories: ['./assets'],
  tagline: 'Documentation for Studyflow and Studyflow Modeler',
  favicon: './assets/img/favicon.ico',

  // Future flags, see https://docusaurus.io/docs/api/docusaurus-config#future
  future: {
    v4: true, // Improve compatibility with the upcoming Docusaurus v4
  },

  plugins: [
    "./src/plugins/tailwind.ts",
    ["@cmfcmf/docusaurus-search-local",
      {
        indexDocs: true,
        indexBlog: false,
        indexPages: true,
        style: "none",
      }
    ]
  ],

  // Set the production url of your site here
  url: 'https://behaverse.org',
  // Set the /<baseUrl>/ pathname under which your site is served
  // For GitHub pages deployment, it is often '/<projectName>/'
  baseUrl: '/studyflow-modeler/docs/',

  // GitHub pages deployment config.
  organizationName: 'behaverse', // GitHub org/user name.
  projectName: 'studyflow-modeler', // Usually your repo name.

  onBrokenLinks: 'throw',

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
          sidebarPath: undefined,
          routeBasePath: '/',
          path: './pages',
          remarkPlugins: [remarkMath],
          rehypePlugins: [rehypeKatex],
        },
        blog: false,
        theme: {
          customCss: require.resolve("./assets/css/custom.css")
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    // Replace with your project's social card
    // image: 'img/docusaurus-social-card.jpg',
    colorMode: {
      respectPrefersColorScheme: true,
    },
    docs: {
      sidebar: {
        hideable: false,
        autoCollapseCategories: true,
      },
    },
    navbar: {
      title: 'Studyflow Docs',
      logo: {
        src: 'img/logo.png',
      },
      items: [
        {
          href: 'https://github.com/behaverse/studyflow-modeler',
          html: '<i class="bi bi-github"></i>',
          position: 'right',
        },
        {
          type: 'search',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'light',
      links: [],
      copyright: `Copyright © ${new Date().getFullYear()} xCIT`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
