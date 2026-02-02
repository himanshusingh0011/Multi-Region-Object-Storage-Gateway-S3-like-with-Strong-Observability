const express = require('express');
const fs = require('fs-extra');
const path = require('path');
const crypto = require('crypto');
const bodyParser = require('body-parser');

const app = express();
const PORT = process.env.PORT || 3001;
const STORAGE_DIR = path.join(__dirname, `storage_${PORT}`);

// Initialize storage
fs.ensureDirSync(STORAGE_DIR);

app.use(bodyParser.raw({ type: 'application/octet-stream', limit: '500mb' }));
app.use(express.json());

// Helper: MD5 Checksum
const calculateChecksum = (data) => crypto.createHash('md5').update(data).digest('hex');

// 1. WRITE Chunk
app.put('/data/:id', async (req, res) => {
    const objectId = req.params.id;
    const data = req.body;
    const providedChecksum = req.headers['x-checksum'];
    
    // Simulate Network Delay (Chaos Testing)
    if (Math.random() < 0.05) await new Promise(r => setTimeout(r, 2000)); 

    const calculatedChecksum = calculateChecksum(data);
    if (providedChecksum && providedChecksum !== calculatedChecksum) {
        return res.status(400).json({ error: 'Checksum mismatch - Data Corruption' });
    }

    await fs.writeFile(path.join(STORAGE_DIR, objectId), data);
    console.log(`[Node-${PORT}] Stored ${objectId} (${data.length} bytes)`);
    res.status(200).json({ success: true });
});

// 2. READ Chunk
app.get('/data/:id', async (req, res) => {
    const filePath = path.join(STORAGE_DIR, req.params.id);
    if (!await fs.pathExists(filePath)) return res.status(404).json({ error: 'Not found' });

    const data = await fs.readFile(filePath);
    res.set('x-checksum', calculateChecksum(data));
    res.send(data);
});

app.listen(PORT, () => {
    console.log(`Storage Node active on port ${PORT}`);
});