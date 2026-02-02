# ☁️ Distributed S3-Compatible Object Storage Gateway

![Node.js](https://img.shields.io/badge/Node.js-v18-green?style=flat&logo=node.js)
![Architecture](https://img.shields.io/badge/Architecture-Distributed-blue?style=flat)
![Consistency](https://img.shields.io/badge/Consistency-Quorum%20(W%3D2)-orange?style=flat)
![Observability](https://img.shields.io/badge/Observability-Prometheus-red?style=flat&logo=prometheus)

A resilient, distributed object storage system built from scratch in Node.js. It features **Strong Consistency** via Quorum writes, **High Availability** through replication, and **Self-Healing** capabilities.

This project simulates a cloud-native storage architecture (like AWS S3) with a Gateway service and isolated Data Nodes.

---

## 📸 System Demo
*Running the full distributed cluster locally: 3 Storage Nodes + 1 Gateway.*

![Full System Demo](./screenshots/demo-full-system.png)

---

## 🏗️ Architecture

The system follows a **Leaderless Replication** model managed by a central Gateway.

```mermaid
graph TD;
    Client[Client (curl/app)] -->|HTTP PUT/GET| Gateway;
    subgraph Distributed Cluster
    Gateway[Gateway Service] -->|Replicate| Node1[Data Node 1];
    Gateway -->|Replicate| Node2[Data Node 2];
    Gateway -->|Replicate| Node3[Data Node 3];
    end
    Gateway -.->|Metrics| Prometheus[Observability];

```

### Key Technical Features

* **🛡️ Quorum Consensus:** Writes are only acknowledged when `W` nodes confirm storage (Configured `W=2` for a 3-node cluster).
* **🔄 Automated Self-Healing:**
* **Read Repair:** If a read request hits a stale node, the gateway fetches from a valid replica and updates the stale one.
* **Background Workers:** An async worker scans for `replication_lag` and retries failed writes to ensure eventual consistency.


* **📊 Observability First:** Built-in Prometheus metrics endpoint tracking `storage_errors`, `latency`, and `replication_lag`.
* **🗂️ Versioning:** Supports object versioning, allowing retrieval of previous file states.
* **🔒 Data Integrity:** End-to-end MD5 checksum validation to detect bit-rot or corruption during network transfer.

---

## 🚀 Getting Started

### Prerequisites

* Node.js (v14+)
* NPM

### Installation

```bash
git clone [https://github.com/your-username/s3-distributed-gateway.git](https://github.com/your-username/s3-distributed-gateway.git)
cd s3-distributed-gateway
npm install

```

### Running the Cluster

You need to spin up the storage layer (nodes) and the access layer (gateway).

**1. Start Storage Nodes (Run in 3 separate terminals)**

```bash
npm run start-node-1   # Runs on port 3001
npm run start-node-2   # Runs on port 3002
npm run start-node-3   # Runs on port 3003

```

**2. Start the Gateway (Run in a 4th terminal)**

```bash
npm run start-gateway  # Runs on port 8080

```

---

## 📡 API Usage

### 1. Upload Object (PUT)

The system shards the data and distributes it to the nodes.

```bash
curl -X PUT -H "Content-Type: application/octet-stream" \
     --data "Hello Distributed World" \
     http://localhost:8080/s3/my-bucket/file1.txt

```

*Response:*

```json
{
  "message": "Uploaded",
  "versionId": "75182327-9e95-4db5-ab4e-a9c51e546e35"
}

```

### 2. Retrieve Object (GET)

Fetches the object from the nearest healthy node.

```bash
curl http://localhost:8080/s3/my-bucket/file1.txt

```

### 3. Check Metrics

Monitor the health of the cluster.

```bash
curl http://localhost:8080/metrics

```

---

## 📊 Observability & Metrics

The system exposes real-time metrics for monitoring tools like Prometheus/Grafana.

| Metric | Description |
| --- | --- |
| `storage_errors` | Counter for failed write/read attempts to nodes. |
| `replication_lag` | Gauge showing how many objects are pending repair (divergent replicas). |
| `http_request_duration` | Histogram of latency for Gateway requests. |

---

## 🧪 Chaos Engineering (Proof of Reliability)

To demonstrate the system's fault tolerance, perform the "Kill Test":

1. **Kill a Node:** Stop `Node-3` (CTRL+C).
2. **Write Data:** Send a `PUT` request.
* *Result:* **Success**. The Gateway detects 2 healthy nodes (meeting Quorum `W=2`) and accepts the write.
* *Log:* `[Warn] Quorum met, but nodes failed. Scheduling repair.`


3. **Verify Lag:** Check `/metrics` → `replication_lag` will increase to `1`.
4. **Revive Node:** Restart `Node-3`.
5. **Self-Healing:** The background worker automatically pushes the missing data to `Node-3`. `replication_lag` drops to `0`.

---

## 💻 Internal Architecture

*A peek into the Gateway's write logic handling consistency and metadata.*

---

### Author

**Himanshu Singh**
*Distributed Systems Enthusiast & Backend Engineer*

```
