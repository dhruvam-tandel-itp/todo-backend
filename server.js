// import express from 'express';
// import mysql from 'mysql2/promise';
// import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
// import dotenv from 'dotenv';

// // Load .env variables
// dotenv.config();

// const app = express();
// const PORT = process.env.PORT || 3000;

// app.use(express.json());
// app.use(express.static('.')); // Serve frontend files

// let writerPool;
// let readerPool;

// /**
//  * Connects to AWS Secrets Manager, safely ensures the MySQL DB structure exists 
//  * on the cluster writer node, and instantiates read/write split pools.
//  */
// async function initializeDatabase() {
//     try {
//         console.log("Fetching DB credentials from AWS Secrets Manager...");
//         const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
//         const command = new GetSecretValueCommand({ SecretId: process.env.DB_SECRET_ARN });
//         const data = await client.send(command);

//         if (!data.SecretString) {
//             throw new Error("SecretString is empty or missing from Secrets Manager.");
//         }

//         const credentials = JSON.parse(data.SecretString);
//         const targetDbName = process.env.DB_NAME;
        
//         // Base connection specs (Standard default port for Aurora MySQL is 3006)
//         const baseDbConfig = {
//             user: credentials.username,
//             password: credentials.password,
//             port: credentials.port || 3306,
//             waitForConnections: true,
//             connectionLimit: 10,
//             queueLimit: 0
//         };

//         // --- STEP 1: VERIFY/CREATE DATABASE VIA WRITER ENDPOINT ---
//         console.log(`Verifying target database "\${targetDbName}" on Aurora MySQL Writer...`);
        
//         // Establish a temporary connection without targeting a specific database schema
//         const bootstrapConnection = await mysql.createConnection({
//             ...baseDbConfig,
//             host: process.env.DB_WRITER_HOST
//         });
        
//         // Safely declare database schema on the primary writer node if missing
//         // (String interpolation is safe here since DB names cannot be parameterized and it is sourced from your internal verified .env config)
//         await bootstrapConnection.query(`CREATE DATABASE IF NOT EXISTS \`${targetDbName}\``);
//         console.log(`Database "${targetDbName}" verified/created successfully.`);
        
//         // Clean up administrative connection right away
//         await bootstrapConnection.end();


//         // --- STEP 2: INITIALIZE AURORA SPLIT POOLS ---
//         const structuralDbConfig = {
//             ...baseDbConfig,
//             database: targetDbName
//         };

//         // Writer Endpoint Pool (Handles mutating queries: POST, DELETE, and DDL migrations)
//         writerPool = mysql.createPool({
//             ...structuralDbConfig,
//             host: process.env.DB_WRITER_HOST,
//         });

//         // Reader Endpoint Pool (Handles scaling horizontal read workflows: GET)
//         readerPool = mysql.createPool({
//             ...structuralDbConfig,
//             host: process.env.DB_READER_HOST,
//         });

//         // --- STEP 3: AUTOMATIC TABLE CREATION ---
//         console.log("Ensuring todos table exists on Aurora Writer...");
//         const createTableQuery = `
//             CREATE TABLE IF NOT EXISTS todos (
//                 id INT AUTO_INCREMENT PRIMARY KEY,
//                 title VARCHAR(255) NOT NULL
//             );
//         `;
//         // Structural modifications must always run on the Writer node to propagate out to reader replicas
//         await writerPool.query(createTableQuery);
//         console.log("🚀 Aurora MySQL infrastructure validation complete.");

//     } catch (error) {
//         console.error("❌ Failed to initialize Aurora MySQL environment:", error);
//         process.exit(1);
//     }
// }

// // ---------------- GLOBAL ROUTE HANDLERS ----------------


// // HEALTH: Verifies application and database cluster health
// app.get('/health', async (req, res) => {
//     try {
//         // Ping both pools to verify end-to-end database connectivity
//         await Promise.all([
//             readerPool.query('SELECT 1'),
//             writerPool.query('SELECT 1')
//         ]);
        
//         res.status(200).json({ 
//             status: 'healthy', 
//             timestamp: new Date().toISOString(),
//             database: 'connected' 
//         });
//     } catch (error) {
//         console.error('Health check failed:', error);
//         res.status(503).json({ 
//             status: 'unhealthy', 
//             timestamp: new Date().toISOString(),
//             error: 'Database connection failed' 
//         });
//     }
// });


// // GET: Read calls target your scale-out Aurora Reader Endpoint
// app.get('/api/todos', async (req, res) => {
//     try {
//         const [rows] = await readerPool.query('SELECT id, title FROM todos ORDER BY id DESC');
//         res.json(rows);
//     } catch (error) {
//         console.error('Error executing read query', error);
//         res.status(500).json({ error: 'Internal Server Error' });
//     }
// });

// // POST: Writes must hit your Primary Writer Endpoint
// app.post('/api/todos', async (req, res) => {
//     const { title } = req.body;
//     if (!title) {
//         return res.status(400).json({ error: 'Title is required' });
//     }

//     try {
//         const [result] = await writerPool.query(
//             'INSERT INTO todos (title) VALUES (?)',
//             [title]
//         );
        
//         res.status(201).json({ id: result.insertId, title });
//     } catch (error) {
//         console.error('Error executing write query', error);
//         res.status(500).json({ error: 'Internal Server Error' });
//     }
// });

// // DELETE: Deletions must hit your Primary Writer Endpoint
// app.delete('/api/todos/:id', async (req, res) => {
//     const { id } = req.params;

//     try {
//         const [result] = await writerPool.query('DELETE FROM todos WHERE id = ?', [id]);
        
//         if (result.affectedRows === 0) {
//             return res.status(404).json({ error: 'Todo not found' });
//         }
        
//         res.status(200).json({ message: 'Todo deleted successfully' });
//     } catch (error) {
//         console.error('Error executing delete query', error);
//         res.status(500).json({ error: 'Internal Server Error' });
//     }
// });

// // Block network binding until validation loops resolve successfully
// initializeDatabase().then(() => {
//     app.listen(PORT, () => {
//         console.log(`🌐 Server up on port ${PORT}`);
//     });
// });






require("dotenv").config();

const express = require("express");
const cors = require("cors");

const app = express();

app.use(cors());
app.use(express.json());

// In-memory storage
let todos = [
    {
        id: 1,
        title: "Learn AWS"
    },
    {
        id: 2,
        title: "Build Three Tier Application"
    }
];

let nextId = 3;

/*
====================================
GET ALL TODOS
====================================
*/
app.get("/api/todos", (req, res) => {
    res.json(todos);
});

/*
====================================
ADD TODO
====================================
*/
app.post("/api/todos", (req, res) => {
    const { title } = req.body;

    if (!title) {
        return res.status(400).json({
            message: "Title is required"
        });
    }

    const newTodo = {
        id: nextId++,
        title
    };

    todos.push(newTodo);

    res.status(201).json(newTodo);
});

/*
====================================
DELETE TODO
====================================
*/
app.delete("/api/todos/:id", (req, res) => {
    const id = Number(req.params.id);

    const index = todos.findIndex(todo => todo.id === id);

    if (index === -1) {
        return res.status(404).json({
            message: "Todo not found"
        });
    }

    todos.splice(index, 1);

    res.json({
        message: "Todo deleted successfully"
    });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
