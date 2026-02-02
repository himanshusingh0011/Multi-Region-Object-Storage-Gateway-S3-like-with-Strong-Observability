const express = require('express');
const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const winston = require('winston');
const client = require('prom-client');
const bodyParser = require('body-parser');
const fs = require('fs-extra');
const path = require('path');

const app = express();
const PORT = 8080;
const META_FILE = 'metadata.json';

// --- CONFIGURATION ---
const DATA_NODES = ['http://localhost:3001', 'http://localhost:3002', 'http://localhost:3003'];
const QUORUM = 2; // W=2

// --- OBSERVABILITY ---
const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [new winston.transports.Console()],
});

const storageErrors = new client.Counter({ name: 'storage_errors', help: 'Storage node failures' });
const replicationLag = new client.Gauge({ name: 'replication_lag', help: 'Pending repairs' });

// --- PERSISTENCE (METADATA) ---
let metadata = {};
let repairQueue = []; // List of { storageId, missingNode, data }

async function loadMetadata() {
    if (await fs.pathExists(META_FILE)) {
        metadata = await fs.readJson(META_FILE);
        logger.info('Metadata loaded from disk.');
    }
}
async function saveMetadata() {
    await fs.writeJson(META_FILE, metadata);
}

// --- CORE LOGIC ---
const calculateChecksum = (data) => crypto.createHash('md5').update(data).digest('hex');

// Write with Quorum & Repair Scheduling
async function writeToNodes(storageId, data, checksum) {
    let successCount = 0;
    const failures = [];

    const promises = DATA_NODES.map(node => 
        axios.put(`${node}/data/${storageId}`, data, {
            headers: { 'Content-Type': 'application/octet-stream', 'x-checksum': checksum },
            timeout: 2000
        })
        .then(() => { successCount++; })
        .catch(err => {
            storageErrors.inc();
            failures.push(node);
        })
    );

    await Promise.allSettled(promises);

    // If quorum met but some nodes failed, schedule repair
    if (successCount >= QUORUM && failures.length > 0) {
        logger.warn(`Quorum met, but nodes failed: ${failures.join(', ')}. Scheduling repair.`);
        replicationLag.inc(failures.length);
        
        // Push to in-memory queue (In prod, this goes to Kafka)
        failures.forEach(node => {
            repairQueue.push({ storageId, targetNode: node, data, checksum });
        });
    }

    return successCount >= QUORUM;
}

// Background Repair Worker (Runs every 10 seconds)
setInterval(async () => {
    if (repairQueue.length === 0) return;

    logger.info(`Starting repair job for ${repairQueue.length} items...`);
    const remainingRepairs = [];

    for (const job of repairQueue) {
        try {
            await axios.put(`${job.targetNode}/data/${job.storageId}`, job.data, {
                headers: { 'Content-Type': 'application/octet-stream', 'x-checksum': job.checksum },
                timeout: 2000
            });
            logger.info(`Repair successful for ${job.storageId} on ${job.targetNode}`);
            replicationLag.dec();
        } catch (err) {
            remainingRepairs.push(job); // Retry later
        }
    }
    repairQueue = remainingRepairs;
}, 10000);

// --- ROUTES ---
app.use(bodyParser.raw({ type: 'application/octet-stream', limit: '100mb' }));
app.use(express.json()); // For JSON bodies if needed

// 1. UPLOAD (S3 PUT)
app.put('/s3/:bucket/:key', async (req, res) => {
    const { bucket, key } = req.params;
    const data = req.body;
    const checksum = calculateChecksum(data);
    const storageId = uuidv4();
    const versionId = uuidv4();

    logger.info(`Incoming Write: ${bucket}/${key}`);

    const success = await writeToNodes(storageId, data, checksum);

    if (!success) {
        logger.error('Write failed: Quorum not met');
        return res.status(503).json({ error: 'Service Unavailable - Quorum Failed' });
    }

    if (!metadata[bucket]) metadata[bucket] = {};
    if (!metadata[bucket][key]) metadata[bucket][key] = [];

    metadata[bucket][key].unshift({
        versionId, storageId, size: data.length, checksum,
        timestamp: new Date().toISOString()
    });
    
    await saveMetadata();
    res.json({ message: 'Uploaded', versionId });
});

// 2. DOWNLOAD (S3 GET)
app.get('/s3/:bucket/:key', async (req, res) => {
    const { bucket, key } = req.params;
    if (!metadata[bucket]?.[key]) return res.status(404).json({ error: 'Not Found' });

    const meta = metadata[bucket][key][0]; // Get latest version

    // Read Repair / HA Read
    for (const node of DATA_NODES) {
        try {
            const response = await axios.get(`${node}/data/${meta.storageId}`, { responseType: 'arraybuffer' });
            if (calculateChecksum(response.data) === meta.checksum) {
                return res.send(response.data);
            }
        } catch (e) { /* try next node */ }
    }
    res.status(500).json({ error: 'Data unavailable (all replicas failed or corrupted)' });
});

// 3. METRICS
app.get('/metrics', async (req, res) => {
    res.set('Content-Type', client.register.contentType);
    res.end(await client.register.metrics());
});

loadMetadata().then(() => {
    app.listen(PORT, () => console.log(`Gateway running at http://localhost:${PORT}`));
});