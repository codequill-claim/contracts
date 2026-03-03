import fs from 'fs';
import path from 'path';

const ignitionDir = './ignition/deployments';
const outputDir = './abi';

if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
}

function findLatestDeploymentDir(baseDir) {
    if (!fs.existsSync(baseDir)) return null;
    const dirs = fs.readdirSync(baseDir).filter(f => f.startsWith('chain-'));
    if (dirs.length === 0) return null;
    
    // Sort by name or stats if needed, but for now we just take the first one
    // which is the only one in most projects.
    return path.join(baseDir, dirs[0]);
}

const deploymentDir = findLatestDeploymentDir(ignitionDir);
if (!deploymentDir) {
    console.error('No deployment directory found in ignition/deployments');
    process.exit(1);
}

const artifactsDir = path.join(deploymentDir, 'artifacts');
if (!fs.existsSync(artifactsDir)) {
    console.error(`Artifacts directory not found: ${artifactsDir}`);
    process.exit(1);
}

// Map contract names to their desired ABI filenames
// to maintain consistency with existing filenames in /abi
const fileNameMap = {
    'CodeQuillAttestationRegistry': 'CodeQuillAttestation',
    'CodeQuillSnapshotRegistry': 'CodeQuillSnapshot',
    'CodeQuillReleaseRegistry': 'CodeQuillRelease',
    'CodeQuillBackupRegistry': 'CodeQuillPreservation',
    'CodeQuillPreservationRegistry': 'CodeQuillPreservation'
};

const files = fs.readdirSync(artifactsDir);
console.log(`Extracting ABIs from ${artifactsDir}...`);

for (const file of files) {
    if (file.startsWith('CodeQuill#') && file.endsWith('.json')) {
        const filePath = path.join(artifactsDir, file);
        try {
            const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const abi = content.abi;
            const contractName = content.contractName;
            
            // Use mapped name if available, otherwise use contract name
            const baseName = fileNameMap[contractName] || contractName;
            const outputFile = path.join(outputDir, `${baseName}.abi.json`);
            
            fs.writeFileSync(outputFile, JSON.stringify(abi, null, 2));
            console.log(`Generated ${outputFile}`);
        } catch (e) {
            console.error(`Error processing ${file}: ${e.message}`);
        }
    }
}

console.log('ABI generation complete.');
