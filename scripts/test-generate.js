// Quick test for the ExtendScript generator
const { generateExtendScript } = require('./generate-extendscript');

const jsx = generateExtendScript({
    aepPath: 'C:/test/project.aep',
    projectDir: 'C:/test',
    data: {
        slugName: 'test-project',
        nameTitles: [{ name: 'John Doe', title1: 'Director', title2: 'Film Dept' }],
        keywords: ['Breaking News'],
        images: [{ fileName: 'photo.png', source: 'Getty Images' }],
    },
});

console.log('=== Generated ExtendScript ===');
console.log(jsx);
console.log('=== END ===');
console.log('\nExtendScript generated successfully! Length:', jsx.length, 'chars');
