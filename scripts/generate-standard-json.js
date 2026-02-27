import fs from 'fs';
import path from 'path';

const artifactsDir = './artifacts/contracts';
const buildInfoDir = './artifacts/build-info';
const outputDir = './standard-json-input';

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

function processDirectory(dir) {
    if (!fs.existsSync(dir)) return;
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (fs.statSync(fullPath).isDirectory()) {
            if (file.endsWith('.sol')) {
                processContractFolder(fullPath);
            } else {
                processDirectory(fullPath);
            }
        }
    }
}

function processContractFolder(folderPath) {
    const files = fs.readdirSync(folderPath);
    for (const file of files) {
        if (file.endsWith('.json') && !file.endsWith('.dbg.json') && file !== 'artifacts.d.ts') {
            const artifactPath = path.join(folderPath, file);
            try {
                const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));
                if (artifact.buildInfoId) {
                    const buildInfoPath = path.join(buildInfoDir, `${artifact.buildInfoId}.json`);
                    if (fs.existsSync(buildInfoPath)) {
                        const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf8'));
                        const standardJsonInput = buildInfo.input;
                        const contractName = artifact.contractName;
                        
                        // Only generate for our main contracts, avoid interface/dependency artifacts if possible
                        // although standard json includes everything needed for that build info anyway.
                        const outputFile = path.join(outputDir, `${contractName}.standard-input.json`);
                        fs.writeFileSync(outputFile, JSON.stringify(standardJsonInput, null, 2));
                        console.log(`Generated ${outputFile}`);
                    }
                }
            } catch (e) {
                console.error(`Error processing ${artifactPath}: ${e.message}`);
            }
        }
    }
}

console.log('Generating Standard-JSON input files...');
processDirectory(artifactsDir);
console.log('Done.');
