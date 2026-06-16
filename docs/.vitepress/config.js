export default {
    title: 'margin',
    description: 'Notes in the margin of your manuscript',
    base: '/margin/docs/',
    themeConfig: {
        logo: '/logo.png',
        siteTitle: false,
        socialLinks: [
            { icon: 'github', link: 'https://github.com/prxshetty/margin' }
        ],
        sidebar: [
            {
                items: [
                    { text: 'Overview', link: '/' },
                    { text: 'Getting Started', link: '/getting-started' },
                    { text: 'AI Assist', link: '/ai-assist' },
                    {
                        text: 'Configuration',
                        collapsed: true,
                        items: [
                            { text: 'General', link: '/configuration/general' },
                            { text: 'Appearance', link: '/configuration/appearance' },
                            { text: 'Editor', link: '/configuration/editor' },
                            { text: 'Context', link: '/configuration/context' },
                            { text: 'Endpoints', link: '/configuration/endpoints' },
                            { text: 'Debugging', link: '/configuration/debugging' }
                        ]
                    },
                    { text: 'Writing Guide', link: '/writing-guide' }
                ]
            }
        ]
    }
}
