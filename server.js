require("dotenv").config();

const express = require("express");
const mysql = require("mysql2/promise");

const {
    SecretsManagerClient,
    GetSecretValueCommand
} = require("@aws-sdk/client-secrets-manager");

const app = express();

app.use(express.json());


// ====================================================
// Configuration
// ====================================================

const PORT = process.env.PORT || 5000;

const AWS_REGION = process.env.AWS_REGION;
const DB_SECRET_ARN = process.env.DB_SECRET_ARN;

const DB_WRITER_HOST = process.env.DB_WRITER_HOST;
const DB_READER_HOST = process.env.DB_READER_HOST;

const DB_PORT = Number(process.env.DB_PORT || 3306);
const DB_NAME = process.env.DB_NAME;


// ====================================================
// Validate environment variables
// ====================================================

const requiredEnvironmentVariables = [
    "AWS_REGION",
    "DB_SECRET_ARN",
    "DB_WRITER_HOST",
    "DB_READER_HOST",
    "DB_NAME"
];

for (const variable of requiredEnvironmentVariables) {

    if (!process.env[variable]) {

        console.error(
            `Missing required environment variable: ${variable}`
        );

        process.exit(1);
    }
}


// ====================================================
// AWS Secrets Manager
// ====================================================

const secretsManager = new SecretsManagerClient({
    region: AWS_REGION
});


async function getDatabaseCredentials() {

    console.log(
        "Getting database credentials from AWS Secrets Manager..."
    );

    const command = new GetSecretValueCommand({
        SecretId: DB_SECRET_ARN
    });

    const response = await secretsManager.send(command);

    if (!response.SecretString) {
        throw new Error(
            "Database secret does not contain SecretString"
        );
    }

    const secret = JSON.parse(response.SecretString);

    if (!secret.username || !secret.password) {
        throw new Error(
            "Database secret must contain username and password"
        );
    }

    return {
        username: secret.username,
        password: secret.password
    };
}


// ====================================================
// Database connection pools
// ====================================================

let writerPool;
let readerPool;


async function initializeDatabase() {

    const credentials = await getDatabaseCredentials();

    console.log("Database credentials loaded successfully.");


    // ------------------------------------------------
    // Aurora Writer
    // Used for INSERT, UPDATE and DELETE
    // ------------------------------------------------

    writerPool = mysql.createPool({
        host: DB_WRITER_HOST,
        port: DB_PORT,

        user: credentials.username,
        password: credentials.password,

        database: DB_NAME
    });


    // ------------------------------------------------
    // Aurora Reader
    // Used for SELECT
    // ------------------------------------------------

    readerPool = mysql.createPool({
        host: DB_READER_HOST,
        port: DB_PORT,

        user: credentials.username,
        password: credentials.password,

        database: DB_NAME
    });


    // ------------------------------------------------
    // Test writer connection
    // ------------------------------------------------

    const writerConnection =
        await writerPool.getConnection();

    console.log(
        "Successfully connected to Aurora writer endpoint."
    );

    writerConnection.release();


    // ------------------------------------------------
    // Test reader connection
    // ------------------------------------------------

    const readerConnection =
        await readerPool.getConnection();

    console.log(
        "Successfully connected to Aurora reader endpoint."
    );

    readerConnection.release();
}


// ====================================================
// Health Check
// ====================================================

app.get("/health", async (req, res) => {

    try {

        await readerPool.query("SELECT 1");

        res.status(200).json({
            status: "ok",
            database: "connected"
        });

    } catch (error) {

        console.error(
            "Health check failed:",
            error
        );

        res.status(500).json({
            status: "error",
            database: "disconnected"
        });
    }
});


// ====================================================
// GET ALL TODOS
// Aurora Reader Endpoint
// ====================================================

app.get("/api/todos", async (req, res) => {

    try {

        const [rows] = await readerPool.query(`
            SELECT
                id,
                title,
                completed,
                created_at
            FROM todos
            ORDER BY created_at DESC
        `);

        res.status(200).json(rows);

    } catch (error) {

        console.error(
            "Error fetching todos:",
            error
        );

        res.status(500).json({
            error: "Failed to fetch todos"
        });
    }
});


// ====================================================
// GET TODO BY ID
// Aurora Reader Endpoint
// ====================================================

app.get("/api/todos/:id", async (req, res) => {

    try {

        const todoId = Number(req.params.id);

        if (!Number.isInteger(todoId)) {

            return res.status(400).json({
                error: "Invalid todo ID"
            });
        }


        const [rows] = await readerPool.query(
            `
            SELECT
                id,
                title,
                completed,
                created_at
            FROM todos
            WHERE id = ?
            `,
            [todoId]
        );


        if (rows.length === 0) {

            return res.status(404).json({
                error: "Todo not found"
            });
        }


        res.status(200).json(rows[0]);

    } catch (error) {

        console.error(
            "Error fetching todo:",
            error
        );

        res.status(500).json({
            error: "Failed to fetch todo"
        });
    }
});


// ====================================================
// CREATE TODO
// Aurora Writer Endpoint
// ====================================================

app.post("/api/todos", async (req, res) => {

    try {

        const { title } = req.body;


        if (!title || typeof title !== "string") {

            return res.status(400).json({
                error: "Title is required"
            });
        }


        const cleanTitle = title.trim();


        if (!cleanTitle) {

            return res.status(400).json({
                error: "Title cannot be empty"
            });
        }


        const [result] = await writerPool.query(
            `
            INSERT INTO todos
                (title, completed)
            VALUES
                (?, ?)
            `,
            [cleanTitle, false]
        );


        res.status(201).json({
            id: result.insertId,
            title: cleanTitle,
            completed: false
        });

    } catch (error) {

        console.error(
            "Error creating todo:",
            error
        );

        res.status(500).json({
            error: "Failed to create todo"
        });
    }
});


// ====================================================
// UPDATE TODO
// Aurora Writer Endpoint
// ====================================================

app.put("/api/todos/:id", async (req, res) => {

    try {

        const todoId = Number(req.params.id);


        if (!Number.isInteger(todoId)) {

            return res.status(400).json({
                error: "Invalid todo ID"
            });
        }


        const { title, completed } = req.body;


        if (
            title === undefined &&
            completed === undefined
        ) {

            return res.status(400).json({
                error: "Nothing to update"
            });
        }


        const fields = [];
        const values = [];


        if (title !== undefined) {

            if (
                typeof title !== "string" ||
                !title.trim()
            ) {

                return res.status(400).json({
                    error: "Invalid title"
                });
            }


            fields.push("title = ?");
            values.push(title.trim());
        }


        if (completed !== undefined) {

            if (typeof completed !== "boolean") {

                return res.status(400).json({
                    error: "completed must be boolean"
                });
            }


            fields.push("completed = ?");
            values.push(completed);
        }


        values.push(todoId);


        const [result] = await writerPool.query(
            `
            UPDATE todos
            SET ${fields.join(", ")}
            WHERE id = ?
            `,
            values
        );


        if (result.affectedRows === 0) {

            return res.status(404).json({
                error: "Todo not found"
            });
        }


        res.status(200).json({
            message: "Todo updated successfully"
        });

    } catch (error) {

        console.error(
            "Error updating todo:",
            error
        );

        res.status(500).json({
            error: "Failed to update todo"
        });
    }
});


// ====================================================
// DELETE TODO
// Aurora Writer Endpoint
// ====================================================

app.delete("/api/todos/:id", async (req, res) => {

    try {

        const todoId = Number(req.params.id);


        if (!Number.isInteger(todoId)) {

            return res.status(400).json({
                error: "Invalid todo ID"
            });
        }


        const [result] = await writerPool.query(
            `
            DELETE FROM todos
            WHERE id = ?
            `,
            [todoId]
        );


        if (result.affectedRows === 0) {

            return res.status(404).json({
                error: "Todo not found"
            });
        }


        res.status(200).json({
            message: "Todo deleted successfully"
        });

    } catch (error) {

        console.error(
            "Error deleting todo:",
            error
        );

        res.status(500).json({
            error: "Failed to delete todo"
        });
    }
});


// ====================================================
// Start Server
// ====================================================

async function startServer() {

    try {

        await initializeDatabase();


        app.listen(
            PORT,
            "0.0.0.0",
            () => {

                console.log(
                    `Todo API running on port ${PORT}`
                );

            }
        );

    } catch (error) {

        console.error(
            "Failed to start application:",
            error
        );

        process.exit(1);
    }
}


startServer();
