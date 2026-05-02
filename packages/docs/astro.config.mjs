// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

// https://astro.build/config
export default defineConfig({
	// Set site + base once the GitHub Pages URL is known.
	// site: 'https://<user>.github.io',
	// base: '/doc-agent',
	integrations: [
		starlight({
			title: 'doc-agent',
			description: 'Autonomous documentation freshness agent built on Flue + Effect.',
			customCss: [
				"@fontsource/ibm-plex-mono/400.css",
				"@fontsource/ibm-plex-mono/500.css",
				"@fontsource/ibm-plex-mono/700.css",
				"@fontsource/bangers/400.css",
				"./src/styles/custom.css",
			],
			social: [
				{
					icon: 'github',
					label: 'GitHub',
					// TODO: replace with the real repo URL once pushed to GitHub
					href: 'https://github.com/TODO/doc-agent',
				},
			],
			editLink: {
				// TODO: replace with the real repo URL once pushed to GitHub
				baseUrl: 'https://github.com/TODO/doc-agent/edit/main/packages/docs/',
			},
			lastUpdated: true,
			sidebar: [
				{
					label: 'Overview',
					items: [{ label: 'Introduction', slug: 'index' }],
				},
				{
					label: 'Architecture Decisions',
					autogenerate: { directory: 'decisions' },
				},
				{
					label: 'Guides',
					autogenerate: { directory: 'guides' },
				},
			],
			// One Dollar Stats analytics — add tracker once site ID is known.
			// head: [
			// 	{
			// 		tag: 'script',
			// 		attrs: {
			// 			defer: true,
			// 			src: 'https://cdn.onedollarstats.com/tracker.js',
			// 			'data-site': import.meta.env.PUBLIC_ODS_SITE_ID,
			// 		},
			// 	},
			// ],
		}),
	],
});
