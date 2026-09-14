export function validOutputs(passed = true) {
  const date = '2026-09-14T12:00:00.000Z';
  const colors = { primary: '#334455', background: '#ffffff', text: '#111111' };
  return {
    business: { companyName: 'Example', industry: 'Glass', description: 'Custom glass partitions', productsOrServices: ['Partitions'], targetAudience: ['Homeowners'], websiteGoals: ['Receive enquiries'], desiredActions: ['Request a quote'] },
    design: { styleName: 'Minimal', description: 'Clear architectural layout', mood: ['Calm'], colors, typography: { headingStyle: 'Sans serif', bodyStyle: 'Sans serif' }, layoutPrinciples: ['Readable sections'] },
    content: { pageTitle: 'Home', pageGoal: 'Receive enquiries', sections: [{ type: 'hero', purpose: 'Introduce services', heading: 'Glass partitions', callToAction: 'Request a quote' }], toneOfVoice: 'Professional', keyMessages: ['Made to measure'] },
    developer: { generatedAt: date, website: {
      id: 'site-1', projectId: 'project-1', name: 'Example', status: 'draft',
      designSystem: { colors, typography: { headingFont: 'Arial', bodyFont: 'Arial', baseFontSize: 16 }, spacing: { section: 64, block: 24 }, borderRadius: 8 },
      pages: [{ id: 'page-1', slug: '/', title: 'Home', status: 'draft', order: 0, blocks: [{ id: 'hero-1', type: 'hero', order: 0, visible: true, content: { heading: 'Glass partitions' } }] }],
      createdAt: date, updatedAt: date,
    } },
    qa: { passed, score: passed ? 90 : 40, issues: passed ? [] : [{ code: 'MISSING_CONTACT', severity: 'error', message: 'Contact details need review' }], checkedAt: date },
  };
}
