// ========================================
// KURIOS STORES BACKEND
// Express + PostgreSQL
// ========================================

require("dotenv").config();

const dns = require("dns");

dns.setDefaultResultOrder("ipv4first");

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const multer = require("multer");

const app = express();

app.use(express.json());


// ========================================
// MONNIFY PAYMENT CONFIGURATION
// ========================================

/*
    Put these in your .env file:

    MONNIFY_API_KEY=...
    MONNIFY_SECRET_KEY=...
    MONNIFY_CONTRACT_CODE=...
    MONNIFY_BASE_URL=https://sandbox.monnify.com

    Switch MONNIFY_BASE_URL to https://api.monnify.com
    when you go live.
*/

const MONNIFY_API_KEY = process.env.MONNIFY_API_KEY;
const MONNIFY_SECRET_KEY = process.env.MONNIFY_SECRET_KEY;
const MONNIFY_CONTRACT_CODE = process.env.MONNIFY_CONTRACT_CODE;
const MONNIFY_BASE_URL =
    process.env.MONNIFY_BASE_URL ||
    "https://sandbox.monnify.com";


// ========================================
// OPAY PAYMENT CONFIGURATION
// ========================================

/*
    Put these in your .env file:

    OPAY_MERCHANT_ID=...
    OPAY_PUBLIC_KEY=...
    OPAY_SECRET_KEY=...
    OPAY_BASE_URL=https://testapi.opaycheckout.com

    Switch OPAY_BASE_URL to https://liveapi.opaycheckout.com
    when you go live.
*/

const OPAY_MERCHANT_ID = process.env.OPAY_MERCHANT_ID;
const OPAY_PUBLIC_KEY = process.env.OPAY_PUBLIC_KEY;
const OPAY_SECRET_KEY = process.env.OPAY_SECRET_KEY;
const OPAY_BASE_URL =
    process.env.OPAY_BASE_URL ||
    "https://testapi.opaycheckout.com";

// Your backend's own public URL, used to build the
// OPay callback (webhook) URL. Set this in Render's
// Environment Variables to your Render service URL,
// e.g. https://kurios-stores-backend.onrender.com

const BACKEND_URL =
    process.env.BACKEND_URL ||
    "https://kurios-stores-backend.onrender.com";

const OPAY_CALLBACK_URL =
    BACKEND_URL + "/api/opay/webhook";


// ========================================
// PAYSTACK PAYMENT CONFIGURATION
// ========================================

/*
    Put these in your .env file:

    PAYSTACK_SECRET_KEY=sk_test_...
    PAYSTACK_PUBLIC_KEY=pk_test_...

    Switch to your sk_live_.../pk_live_... keys
    when you go live.
*/

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
const PAYSTACK_PUBLIC_KEY = process.env.PAYSTACK_PUBLIC_KEY;
const PAYSTACK_BASE_URL = "https://api.paystack.co";

const PAYSTACK_CALLBACK_URL =
    BACKEND_URL + "/api/paystack/callback";


// ========================================
// INITIALIZE A PAYSTACK TRANSACTION
// ========================================

async function initializePaystackTransaction({ reference, amountNaira, email, callbackUrl }) {

    if (!PAYSTACK_SECRET_KEY) {
        throw new Error("Paystack is not configured on this server yet.");
    }

    const response = await fetch(
        PAYSTACK_BASE_URL + "/transaction/initialize",
        {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + PAYSTACK_SECRET_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                reference: reference,
                amount: Math.round(amountNaira * 100), // Paystack uses kobo
                email: email || "student@kuriosstores.com",
                callback_url: callbackUrl || PAYSTACK_CALLBACK_URL
            }),
            signal: AbortSignal.timeout(15000)
        }
    );

    const data = await response.json();

    if (!data.status) {
        throw new Error(data.message || "Could not start Paystack checkout.");
    }

    return data.data; // { authorization_url, access_code, reference }

}


// ========================================
// VERIFY A PAYSTACK TRANSACTION
// ========================================

async function verifyPaystackTransaction(reference) {

    if (!PAYSTACK_SECRET_KEY) {
        throw new Error("Paystack is not configured on this server yet.");
    }

    const response = await fetch(
        PAYSTACK_BASE_URL + "/transaction/verify/" + encodeURIComponent(reference),
        {
            headers: {
                "Authorization": "Bearer " + PAYSTACK_SECRET_KEY
            },
            signal: AbortSignal.timeout(15000)
        }
    );

    const data = await response.json();

    if (!data.status) {
        throw new Error(data.message || "Could not verify this payment with Paystack.");
    }

    return data.data; // { status: 'success'|'failed'|..., amount, reference, ... }

}


// ========================================
// SIGN AN OPAY REQUEST
// ========================================

/*
    OPay signs requests with HMAC-SHA512 of the
    request body, signed with your Secret Key.
    The body's keys must be sorted alphabetically
    before signing.
*/

function signOpayPayload(payload) {

    function sortKeys(value) {

        if (Array.isArray(value)) {
            return value.map(sortKeys);
        }

        if (value && typeof value === "object") {

            const sorted = {};

            Object.keys(value)
                .sort()
                .forEach(function (key) {
                    sorted[key] = sortKeys(value[key]);
                });

            return sorted;

        }

        return value;

    }

    const sortedPayload =
        JSON.stringify(sortKeys(payload));

    return crypto
        .createHmac("sha512", OPAY_SECRET_KEY)
        .update(sortedPayload)
        .digest("hex");

}


// ========================================
// CREATE AN OPAY CASHIER PAYMENT
// (returns a hosted checkout URL to redirect to)
// ========================================

async function createOpayCashierPayment({
    reference,
    amountNaira,
    customerName,
    customerEmail,
    description,
    returnUrl,
    callbackUrl
}) {

    const response = await fetch(
        OPAY_BASE_URL + "/api/v1/international/cashier/create",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + OPAY_PUBLIC_KEY,
                "MerchantId": OPAY_MERCHANT_ID
            },
            body: JSON.stringify({
                country: "NG",
                reference: reference,
                amount: {
                    // OPay amounts are in kobo (smallest unit).
                    total: Math.round(amountNaira * 100),
                    currency: "NGN"
                },
                returnUrl: returnUrl,
                callbackUrl: callbackUrl,
                product: {
                    name: "Kurios Stores",
                    description: description || "Kurios Stores payment"
                },
                userInfo: {
                    userName: customerName || "Kurios Student",
                    userEmail: customerEmail || ""
                }
            }),
            signal: AbortSignal.timeout(15000)
        }
    );

    const data = await response.json();

    if (data.code !== "00000") {

        throw new Error(
            "Could not start OPay checkout: " +
            (data.message || "Unknown error")
        );

    }

    return data.data;

}


// ========================================
// QUERY AN OPAY PAYMENT'S STATUS
// ========================================

async function queryOpayPaymentStatus(reference) {

    const payload = {
        reference: reference,
        country: "NG"
    };

    const signature =
        signOpayPayload(payload);

    const response = await fetch(
        OPAY_BASE_URL + "/api/v1/international/cashier/status",
        {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": "Bearer " + signature,
                "MerchantId": OPAY_MERCHANT_ID
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15000)
        }
    );

    const data = await response.json();

    if (data.code !== "00000") {

        throw new Error(
            "Could not verify this payment with OPay: " +
            (data.message || "Unknown error")
        );

    }

    return data.data;

}




// ========================================
// GET A MONNIFY ACCESS TOKEN
// ========================================

/*
    Monnify's API is protected by OAuth2.
    We exchange our API key + secret key for
    a short-lived access token, then use that
    token (as a Bearer header) on every other
    Monnify request.
*/

async function getMonnifyAccessToken() {

    const credentials =
        Buffer.from(
            MONNIFY_API_KEY + ":" + MONNIFY_SECRET_KEY
        ).toString("base64");

    const response = await fetch(
        MONNIFY_BASE_URL + "/api/v1/auth/login",
        {
            method: "POST",
            headers: {
                "Authorization": "Basic " + credentials,
                "Content-Type": "application/json"
            },
            signal: AbortSignal.timeout(15000)
        }
    );

    const data = await response.json();

    if (!data.requestSuccessful) {

        throw new Error(
            "Could not authenticate with Monnify: " +
            (data.responseMessage || "Unknown error")
        );

    }

    return data.responseBody.accessToken;

}


// ========================================
// PROFILE PICTURE UPLOADS
// ========================================

/*
    Uploaded profile pictures are saved to
    an "uploads" folder next to this file,
    and served back out at /uploads/<file>.
*/

const uploadsFolder = path.join(__dirname, "uploads");

if (!fs.existsSync(uploadsFolder)) {
    fs.mkdirSync(uploadsFolder);
}

app.use("/uploads", express.static(uploadsFolder));

const profilePictureStorage = multer.diskStorage({

    destination: function (req, file, cb) {
        cb(null, uploadsFolder);
    },

    filename: function (req, file, cb) {

        const uniqueSuffix =
            Date.now() +
            "-" +
            crypto.randomInt(100000, 999999);

        cb(
            null,
            "profile-" +
                uniqueSuffix +
                path.extname(file.originalname)
        );

    }

});

const profilePictureUpload = multer({

    storage: profilePictureStorage,

    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max
    },

    fileFilter: function (req, file, cb) {

        const allowedTypes =
            ["image/jpeg", "image/png", "image/webp"];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPG, PNG, or WEBP images are allowed."));
        }

    }

});


const productImageStorage = multer.diskStorage({

    destination: function (req, file, cb) {
        cb(null, uploadsFolder);
    },

    filename: function (req, file, cb) {

        const uniqueSuffix =
            Date.now() +
            "-" +
            crypto.randomInt(100000, 999999);

        cb(
            null,
            "product-" +
                uniqueSuffix +
                path.extname(file.originalname)
        );

    }

});

const productImageUpload = multer({

    storage: productImageStorage,

    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB max
    },

    fileFilter: function (req, file, cb) {

        const allowedTypes =
            ["image/jpeg", "image/png", "image/webp"];

        if (allowedTypes.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error("Only JPG, PNG, or WEBP images are allowed."));
        }

    }

});


// ========================================
// CHAT ATTACHMENTS
// (images, documents, and voice notes —
// broader file type allowance than the
// product/profile image uploaders above)
// ========================================

const chatAttachmentStorage = multer.diskStorage({

    destination: function (req, file, cb) {
        cb(null, uploadsFolder);
    },

    filename: function (req, file, cb) {

        const uniqueSuffix =
            Date.now() +
            "-" +
            crypto.randomInt(100000, 999999);

        cb(
            null,
            "chat-" +
                uniqueSuffix +
                path.extname(file.originalname)
        );

    }

});

const chatAttachmentUpload = multer({

    storage: chatAttachmentStorage,

    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    },

    fileFilter: function (req, file, cb) {

        const allowedExactTypes = [
            "image/jpeg", "image/png", "image/webp", "image/gif",
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        ];

        // Voice note mimetypes vary by browser/device and often
        // include a codec suffix (e.g. "audio/webm;codecs=opus"),
        // so any real audio/* type is accepted rather than an
        // exact-match list.

        if (
            allowedExactTypes.includes(file.mimetype) ||
            file.mimetype.indexOf("audio/") === 0
        ) {
            cb(null, true);
        } else {
            cb(new Error("That file type isn't supported."));
        }

    }

});


// ========================================
// CSV IMPORT UPLOAD
// (kept in memory — we only need to parse
// it, not store the file itself)
// ========================================

const csvUpload = multer({

    storage: multer.memoryStorage(),

    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB max
    },

    fileFilter: function (req, file, cb) {

        const allowedTypes = [
            "text/csv",
            "application/vnd.ms-excel",
            "application/csv",
            "text/plain"
        ];

        if (
            allowedTypes.includes(file.mimetype) ||
            file.originalname.toLowerCase().endsWith(".csv")
        ) {
            cb(null, true);
        } else {
            cb(new Error("Please upload a CSV file."));
        }

    }

});


// ========================================
// EMAIL CONFIGURATION (Resend HTTPS API)
// ========================================

/*
    Render does not support outbound IPv6, and Gmail's
    SMTP server resolves to an IPv6 address from Render's
    network — so raw SMTP to Gmail fails with ENETUNREACH.

    Resend sends email over a normal HTTPS API call instead
    of a raw SMTP socket, which avoids that problem entirely.

    Put this in your Render Environment Variables:

    RESEND_API_KEY=...
    EMAIL_FROM=Kurios Stores <onboarding@resend.dev>

    (Once you verify your own domain on Resend, change
    EMAIL_FROM to something like
    "Kurios Stores <no-reply@kuriosstores.com>".)
*/

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const EMAIL_FROM =
    process.env.EMAIL_FROM ||
    "Kurios Stores <onboarding@resend.dev>";

async function sendEmail({ to, subject, html }) {

    const response = await fetch(
        "https://api.resend.com/emails",
        {
            method: "POST",
            headers: {
                "Authorization": "Bearer " + RESEND_API_KEY,
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                from: EMAIL_FROM,
                to: [to],
                subject: subject,
                html: html
            })
        }
    );

    const data = await response.json();

    if (!response.ok) {

        throw new Error(
            "Resend error: " +
            (data.message || JSON.stringify(data))
        );

    }

    return data;

}

if (!RESEND_API_KEY) {
    console.error(
        "Email configuration error: RESEND_API_KEY is not set."
    );
} else {
    console.log("Email is configured via Resend.");
}

// ========================================
// MIDDLEWARE
// ========================================

app.use(cors());


// =============================================
// POSTGRESQL CONNECTION
// =============================================

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: {
        rejectUnauthorized: false
    }
});

// ========================================
// TEST DATABASE CONNECTION
// ========================================

pool.query("SELECT NOW()")
    .then(() => {
        console.log(
            "Kurios Stores connected to PostgreSQL successfully."
        );
    })
    .catch((error) => {
        console.error(
            "PostgreSQL connection failed:",
            error.message
        );
    });


// ========================================
// AUTO-MIGRATE BASE TABLES
// ========================================

/*
    Creates the core tables this app needs if
    they don't already exist — so a brand new
    database (like on a fresh Render deploy)
    works without anyone running SQL by hand.
    Existing tables/data are left untouched.
*/

async function ensureBaseTablesExist() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS students (
                id SERIAL PRIMARY KEY,
                first_name TEXT NOT NULL,
                last_name TEXT NOT NULL,
                email TEXT UNIQUE NOT NULL,
                phone TEXT,
                whatsapp_number TEXT,
                university TEXT,
                student_id TEXT,
                password_hash TEXT NOT NULL,
                agreed_terms BOOLEAN DEFAULT false,
                agreed_privacy BOOLEAN DEFAULT false,
                receive_notifications BOOLEAN DEFAULT true,
                email_verified BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS student_verification_codes (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES students(id),
                otp TEXT NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                verified BOOLEAN DEFAULT false,
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS products (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                price NUMERIC(12, 2) NOT NULL,
                image_url TEXT,
                category TEXT,
                stock_quantity INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Base tables (students, student_verification_codes, products) are ready."
        );

    } catch (error) {

        console.error(
            "Could not create base tables:",
            error.message
        );

    }

}


// ========================================
// AUTO-MIGRATE NEW PROFILE COLUMNS
// ========================================

/*
    Adds the date_of_birth and profile_picture
    columns to the students table if they don't
    already exist yet, so nothing needs to be
    run manually in psql.
*/

async function ensureProfileColumnsExist() {

    try {

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS date_of_birth DATE
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS profile_picture TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS is_suspended BOOLEAN DEFAULT false
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS is_support BOOLEAN DEFAULT false
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS passcode_history JSONB DEFAULT '[]'::jsonb
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12, 2) DEFAULT 0
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS wallet_topups (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES students(id),
                payment_reference TEXT UNIQUE NOT NULL,
                transaction_reference TEXT,
                amount NUMERIC(12, 2) NOT NULL,
                payment_gateway TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Profile columns (date_of_birth, profile_picture, is_suspended, is_support, passcode_history, wallet_balance) are ready."
        );

    } catch (error) {

        console.error(
            "Could not add profile columns:",
            error.message
        );

    }

}


// ========================================
// AUTO-MIGRATE ORDERS TABLE
// ========================================

async function ensureOrdersTableExists() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS orders (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES students(id),
                payment_reference TEXT UNIQUE NOT NULL,
                transaction_reference TEXT,
                items JSONB NOT NULL,
                amount NUMERIC(12, 2) NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Orders table is ready."
        );

        await pool.query(
            `
            ALTER TABLE orders
            ADD COLUMN IF NOT EXISTS payment_gateway TEXT
            `
        );

    } catch (error) {

        console.error(
            "Could not create orders table:",
            error.message
        );

    }

}


async function ensureSellersTableExists() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS sellers (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES students(id),
                seller_type TEXT NOT NULL DEFAULT 'student_seller',
                store_name TEXT NOT NULL,
                store_description TEXT,
                business_category TEXT,
                location TEXT,
                store_image TEXT,
                contact_phone TEXT,
                contact_whatsapp TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                rejection_reason TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Sellers table is ready."
        );

    } catch (error) {

        console.error(
            "Could not create sellers table:",
            error.message
        );

    }

}


// ========================================
// ADMINS + ADMIN SESSIONS
// ========================================

async function ensureAdminTablesExist() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                name TEXT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS admin_sessions (
                id SERIAL PRIMARY KEY,
                admin_id INTEGER REFERENCES admins(id),
                token TEXT UNIQUE NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Admin tables are ready."
        );

    } catch (error) {

        console.error(
            "Could not create admin tables:",
            error.message
        );

    }

}


// ========================================
// ADMIN TABLE — USERNAME COLUMN SAFETY NET
// (in case an earlier deploy already created
// the admins table with the old email-based
// schema — adds username without breaking
// any existing rows)
// ========================================

async function ensureAdminUsernameColumnExists() {

    try {

        await pool.query(
            `ALTER TABLE admins ADD COLUMN IF NOT EXISTS username TEXT`
        );

        console.log(
            "Admin username column is ready."
        );

    } catch (error) {

        console.error(
            "Could not add admin username column:",
            error.message
        );

    }

}


// ========================================
// SEED THE FIRST ADMIN ACCOUNT
// (from environment variables, only if
// there are no admins yet)
// ========================================

/*
    Put this in your Render Environment Variables
    to create your first admin account automatically:

    ADMIN_PASSWORD=choose-a-strong-password

    The username defaults to "Elkurios" unless you
    also set ADMIN_USERNAME to something else.

    After the first admin exists, these env vars are
    no longer used — manage further admins directly
    in the database, or extend this later with an
    "invite another admin" feature.
*/

async function seedInitialAdmin() {

    try {

        const existing =
            await pool.query(`SELECT id FROM admins LIMIT 1`);

        if (existing.rows.length > 0) {
            return;
        }

        if (!process.env.ADMIN_PASSWORD) {

            console.log(
                "No admin account yet — set ADMIN_PASSWORD (and optionally ADMIN_USERNAME) to create one."
            );

            return;

        }

        const username =
            (process.env.ADMIN_USERNAME || "Elkurios").trim();

        const passwordHash =
            await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);

        await pool.query(
            `
            INSERT INTO admins (name, username, password_hash)
            VALUES ($1, $2, $3)
            `,
            [
                "Kurios Admin",
                username,
                passwordHash
            ]
        );

        console.log(
            "Initial admin account created with username " + username
        );

    } catch (error) {

        console.error(
            "Could not seed initial admin:",
            error.message
        );

    }

}


// ========================================
// SELLER PAYMENT COLUMNS
// (application fee tracking)
// ========================================

async function ensureSellerPaymentColumnsExist() {

    try {

        await pool.query(
            `
            ALTER TABLE sellers
            ADD COLUMN IF NOT EXISTS application_fee NUMERIC(12, 2) DEFAULT 1500
            `
        );

        await pool.query(
            `
            ALTER TABLE sellers
            ADD COLUMN IF NOT EXISTS payment_reference TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE sellers
            ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'unpaid'
            `
        );

        await pool.query(
            `
            ALTER TABLE sellers
            ADD COLUMN IF NOT EXISTS transaction_reference TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE sellers
            ADD COLUMN IF NOT EXISTS payment_gateway TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE sellers
            ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(12, 2) DEFAULT 0
            `
        );

        await pool.query(
            `
            ALTER TABLE sellers
            ADD COLUMN IF NOT EXISTS bank_name TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE sellers
            ADD COLUMN IF NOT EXISTS bank_account_number TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE sellers
            ADD COLUMN IF NOT EXISTS bank_account_name TEXT
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS payout_requests (
                id SERIAL PRIMARY KEY,
                seller_id INTEGER REFERENCES sellers(id),
                amount NUMERIC(12, 2) NOT NULL,
                bank_name TEXT NOT NULL,
                bank_account_number TEXT NOT NULL,
                bank_account_name TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                admin_note TEXT,
                payout_reference TEXT,
                requested_at TIMESTAMP DEFAULT NOW(),
                processed_at TIMESTAMP
            )
            `
        );

        console.log(
            "Seller payment columns are ready."
        );

    } catch (error) {

        console.error(
            "Could not add seller payment columns:",
            error.message
        );

    }

}


// ========================================
// NOTIFICATIONS TABLE
// (admin announcements sent to all students)
// ========================================

async function ensureNotificationsTableExists() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS notifications (
                id SERIAL PRIMARY KEY,
                title TEXT NOT NULL,
                message TEXT NOT NULL,
                created_by INTEGER REFERENCES admins(id),
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Notifications table is ready."
        );

    } catch (error) {

        console.error(
            "Could not create notifications table:",
            error.message
        );

    }

}


// ========================================
// PRODUCT SELLER COLUMNS
// (let products belong to a seller, and
// let sellers/admin hide a product)
// ========================================

async function ensureProductSellerColumnsExist() {

    try {

        await pool.query(
            `
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS seller_id INTEGER REFERENCES sellers(id)
            `
        );

        await pool.query(
            `
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true
            `
        );

        await pool.query(
            `
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
            `
        );

        await pool.query(
            `
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS sku TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE sellers
            ADD COLUMN IF NOT EXISTS is_official BOOLEAN DEFAULT false
            `
        );

        await pool.query(
            `
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS discount_price NUMERIC(12, 2)
            `
        );

        await pool.query(
            `
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS discount_starts_at TIMESTAMP
            `
        );

        await pool.query(
            `
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS discount_ends_at TIMESTAMP
            `
        );

        console.log(
            "Product seller columns are ready."
        );

    } catch (error) {

        console.error(
            "Could not add product seller columns:",
            error.message
        );

    }

}


// ========================================
// SEED KURIOS STORES AS AN APPROVED SELLER
// ========================================

/*
    Kurios Stores' own products (added directly,
    not through a student's seller application)
    belong to this seller row so they show "Sold
    by Kurios Stores" and get a real storefront
    page like any other seller — instead of being
    a special, unattributed case.

    This has no student_id (it isn't owned by a
    student account), skips the application fee,
    and is approved by default.
*/

async function seedKuriosStoresSeller() {

    try {

        const existing = await pool.query(
            `
            SELECT id
            FROM sellers
            WHERE is_official = true
            LIMIT 1
            `
        );

        let kuriosSellerId;

        if (existing.rows.length > 0) {

            kuriosSellerId = existing.rows[0].id;

        } else {

            const inserted = await pool.query(
                `
                INSERT INTO sellers (
                    student_id,
                    seller_type,
                    store_name,
                    store_description,
                    status,
                    application_fee,
                    payment_status,
                    is_official
                )
                VALUES (NULL, 'vendor', 'Kurios Stores', 'Official Kurios Stores products.', 'approved', 0, 'paid', true)
                RETURNING id
                `
            );

            kuriosSellerId = inserted.rows[0].id;

            console.log(
                "Seeded Kurios Stores as an approved seller (id " + kuriosSellerId + ")."
            );

        }


        // Attach any pre-existing, unattributed
        // products to Kurios Stores.

        await pool.query(
            `
            UPDATE products
            SET seller_id = $1
            WHERE seller_id IS NULL
            `,
            [kuriosSellerId]
        );

    } catch (error) {

        console.error(
            "Could not seed Kurios Stores seller:",
            error.message
        );

    }

}


// ========================================
// MESSAGES TABLE (student-to-student chat)
// ========================================

async function ensureMessagesTableExists() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS messages (
                id SERIAL PRIMARY KEY,
                sender_id INTEGER REFERENCES students(id),
                recipient_id INTEGER REFERENCES students(id),
                body TEXT NOT NULL,
                read_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Messages table is ready."
        );

    } catch (error) {

        console.error(
            "Could not create messages table:",
            error.message
        );

    }

}


// ========================================
// CHAT — CONVERSATIONS SCHEMA
// (unified conversation model: every thread
// has a type + optional context, so the same
// tables serve normal chats, product chats,
// order chats, and support chats later —
// instead of a separate table per use case)
// ========================================

async function ensureConversationsSchemaExists() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                type TEXT NOT NULL DEFAULT 'NORMAL',
                context_id INTEGER,
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS conversation_participants (
                id SERIAL PRIMARY KEY,
                conversation_id INTEGER REFERENCES conversations(id),
                student_id INTEGER REFERENCES students(id),
                last_read_at TIMESTAMP,
                joined_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (conversation_id, student_id)
            )
            `
        );

        await pool.query(
            `
            CREATE INDEX IF NOT EXISTS idx_conversation_participants_student
            ON conversation_participants (student_id)
            `
        );

        await pool.query(
            `
            ALTER TABLE messages
            ADD COLUMN IF NOT EXISTS conversation_id INTEGER REFERENCES conversations(id)
            `
        );

        await pool.query(
            `
            ALTER TABLE messages
            ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'TEXT'
            `
        );

        await pool.query(
            `
            ALTER TABLE messages
            ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP
            `
        );

        await pool.query(
            `
            ALTER TABLE messages
            ADD COLUMN IF NOT EXISTS attachment_url TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE messages
            ADD COLUMN IF NOT EXISTS attachment_name TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE messages
            ADD COLUMN IF NOT EXISTS attachment_size INTEGER
            `
        );

        await pool.query(
            `
            CREATE INDEX IF NOT EXISTS idx_messages_conversation_id
            ON messages (conversation_id)
            `
        );

        await pool.query(
            `
            CREATE INDEX IF NOT EXISTS idx_messages_created_at
            ON messages (created_at)
            `
        );

        await pool.query(
            `
            ALTER TABLE messages
            ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP
            `
        );

        await pool.query(
            `
            ALTER TABLE conversations
            ADD COLUMN IF NOT EXISTS support_status TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE conversations
            ADD COLUMN IF NOT EXISTS claimed_by INTEGER REFERENCES students(id)
            `
        );

        await pool.query(
            `
            ALTER TABLE conversations
            ADD COLUMN IF NOT EXISTS claimed_at TIMESTAMP
            `
        );

        await pool.query(
            `
            ALTER TABLE conversations
            ADD COLUMN IF NOT EXISTS ticket_number TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE conversations
            ADD COLUMN IF NOT EXISTS ticket_number TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE conversations
            ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS message_reactions (
                id SERIAL PRIMARY KEY,
                message_id INTEGER REFERENCES messages(id) ON DELETE CASCADE,
                student_id INTEGER REFERENCES students(id),
                emoji TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (message_id, student_id)
            )
            `
        );

        await pool.query(
            `
            CREATE INDEX IF NOT EXISTS idx_message_reactions_message_id
            ON message_reactions (message_id)
            `
        );


        // ====================================
        // BACKFILL — every existing 1:1 message
        // (from the old sender/recipient model)
        // gets folded into a NORMAL conversation,
        // so no chat history is lost.
        // ====================================

        const unmigratedPairs = await pool.query(
            `
            SELECT DISTINCT
                LEAST(sender_id, recipient_id) AS student_a,
                GREATEST(sender_id, recipient_id) AS student_b
            FROM messages
            WHERE conversation_id IS NULL
            `
        );

        for (const pair of unmigratedPairs.rows) {

            const conversationResult = await pool.query(
                `
                INSERT INTO conversations (type, context_id)
                VALUES ('NORMAL', NULL)
                RETURNING id
                `
            );

            const conversationId =
                conversationResult.rows[0].id;

            await pool.query(
                `
                INSERT INTO conversation_participants (conversation_id, student_id)
                VALUES ($1, $2), ($1, $3)
                ON CONFLICT DO NOTHING
                `,
                [conversationId, pair.student_a, pair.student_b]
            );

            await pool.query(
                `
                UPDATE messages
                SET conversation_id = $1
                WHERE conversation_id IS NULL
                AND (
                    (sender_id = $2 AND recipient_id = $3)
                    OR (sender_id = $3 AND recipient_id = $2)
                )
                `,
                [conversationId, pair.student_a, pair.student_b]
            );

        }

        if (unmigratedPairs.rows.length > 0) {

            console.log(
                "Backfilled " +
                unmigratedPairs.rows.length +
                " existing chat thread(s) into the new conversations schema."
            );

        }


        // ====================================
        // MERGE DUPLICATE CONVERSATIONS
        // (a student pair should only ever have
        // ONE conversation per type+context — this
        // cleans up any duplicates that slipped in
        // before that was consistently enforced)
        // ====================================

        const duplicateGroups = await pool.query(
            `
            SELECT
                LEAST(cp1.student_id, cp2.student_id) AS student_a,
                GREATEST(cp1.student_id, cp2.student_id) AS student_b,
                c.type,
                c.context_id,
                array_agg(c.id ORDER BY c.id ASC) AS conversation_ids
            FROM conversations c
            JOIN conversation_participants cp1 ON cp1.conversation_id = c.id
            JOIN conversation_participants cp2
                ON cp2.conversation_id = c.id
                AND cp2.student_id != cp1.student_id
            GROUP BY student_a, student_b, c.type, c.context_id
            HAVING COUNT(DISTINCT c.id) > 1
            `
        );

        for (const group of duplicateGroups.rows) {

            const ids = group.conversation_ids;
            const keepId = ids[0];
            const duplicateIds = ids.slice(1);

            for (const dupId of duplicateIds) {

                await pool.query(
                    `UPDATE messages SET conversation_id = $1 WHERE conversation_id = $2`,
                    [keepId, dupId]
                );

                await pool.query(
                    `DELETE FROM conversation_participants WHERE conversation_id = $1`,
                    [dupId]
                );

                await pool.query(
                    `DELETE FROM conversations WHERE id = $1`,
                    [dupId]
                );

            }

        }

        if (duplicateGroups.rows.length > 0) {

            console.log(
                "Merged " +
                duplicateGroups.rows.length +
                " duplicate conversation group(s)."
            );

        }

        console.log(
            "Conversations schema is ready."
        );

    } catch (error) {

        console.error(
            "Could not set up conversations schema:",
            error.message
        );

    }

}



// ========================================
// KSUPPORT SYSTEM ACCOUNT
// (a real student row used as the sender
// for automated ticket messages — "Elkurios"
// speaks through this account)
// ========================================

let ksupportSystemAccountId = null;

async function ensureKSupportSystemAccount() {

    try {

        const existing = await pool.query(
            `SELECT id FROM students WHERE email = 'system@kuriosstores.com' LIMIT 1`
        );

        if (existing.rows.length > 0) {

            ksupportSystemAccountId = existing.rows[0].id;
            return;

        }

        const created = await pool.query(
            `
            INSERT INTO students (
                first_name, last_name, email, phone, university, student_id,
                password_hash, email_verified, is_support
            )
            VALUES (
                'Elkurios', '', 'system@kuriosstores.com', '00000000000',
                'Kurios Stores', 'SYSTEM', 'no-login', true, true
            )
            RETURNING id
            `
        );

        ksupportSystemAccountId = created.rows[0].id;

        console.log(
            "KSupport system account created (id " + ksupportSystemAccountId + ")."
        );

    } catch (error) {

        console.error(
            "Could not set up KSupport system account:",
            error.message
        );

    }

}

function generateTicketNumber() {

    return "#" + Math.floor(100000 + Math.random() * 900000);

}

async function sendKSupportAutoMessage(conversationId, recipientId, body) {

    if (!ksupportSystemAccountId) {

        // Shouldn't happen now that the server waits for
        // migrations before accepting requests — but if it
        // ever does, try once more and log it clearly rather
        // than silently dropping the automated message.

        await ensureKSupportSystemAccount();

        if (!ksupportSystemAccountId) {

            console.error(
                "sendKSupportAutoMessage: KSupport system account is still not available — automated message was not sent for conversation " +
                conversationId
            );

            return;

        }

    }

    try {

        const result = await pool.query(
            `
            INSERT INTO messages (sender_id, recipient_id, body, conversation_id, message_type)
            VALUES ($1, $2, $3, $4, 'TEXT')
            RETURNING *
            `,
            [ksupportSystemAccountId, recipientId, body, conversationId]
        );

        await pool.query(
            `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [conversationId]
        );

        if (typeof io !== "undefined" && recipientId) {

            io.to("student:" + recipientId).emit(
                "new_message",
                result.rows[0]
            );

        }

    } catch (error) {

        console.error(
            "Send KSupport auto message error:",
            error.message
        );

    }

}


// ========================================
// KSUPPORT MESSAGE TEMPLATES
// ========================================

const KSUPPORT_TEMPLATES = {

    received: function (ticketNumber) {
        return `Thank you for chatting with KSupport.\nFor reference, please note that your ticket number is ${ticketNumber}.\nA member of our support team will attend to you as soon as possible. In the meantime, kindly state your complaint or describe the issue you are experiencing so we can better understand and assist you.\nWe appreciate your patience.\nKSupport — We're here to help.`;
    },

    assigned: function (ticketNumber, studentName) {
        return `Hello ${studentName},\nYour support request ${ticketNumber} has been assigned to a KSupport Staff and is now being attended to.\nThe support staff will review your complaint and respond to you shortly. Kindly remain available in case additional information or clarification is required.\nThank you for your patience and for choosing KSupport.\nKSupport — We're here to help.`;
    },

    resolved: function (ticketNumber, studentName) {
        return `Hello ${studentName},\nYour support request ${ticketNumber} has been resolved by KSupport.\nWe hope your issue has been satisfactorily addressed. If you need further assistance regarding this matter, you may reopen the ticket or submit a new support request.\nThank you for using KSupport.\nKSupport — We're here to help.`;
    },

    closed: function (ticketNumber, studentName) {
        return `Hello ${studentName},\nYour support request ${ticketNumber} has now been closed.\nThank you for contacting KSupport. We appreciate your patience and the opportunity to assist you.\nIf you require further assistance, you can always submit a new support request.\nKSupport — We're here to help.`;
    },

    reopened: function (ticketNumber, studentName) {
        return `Hello ${studentName},\nYour support request ${ticketNumber} has been reopened.\nA KSupport staff member will review the request and continue working with you to resolve the issue.\nThank you for contacting KSupport.\nKSupport — We're here to help.`;
    },

    transferred: function (ticketNumber, studentName) {
        return `Hello ${studentName},\nYour support request ${ticketNumber} has been transferred to another KSupport staff member to ensure that your issue is handled by the appropriate support personnel.\nThe new support staff will review your complaint and continue assisting you shortly.\nThank you for your patience and understanding.\nKSupport — We're here to help.`;
    },

    infoRequested: function (ticketNumber, studentName) {
        return `Hello ${studentName},\nTo help us resolve your support request ${ticketNumber}, we need some additional information from you.\nKindly provide the requested details so our support staff can proceed with resolving your complaint.\nThank you for your cooperation.\nKSupport — We're here to help.`;
    }

};



// ========================================
// WALLET TRANSACTIONS
// (a ledger of every credit/debit to a
// seller's wallet — right now only credits
// from confirmed sales; withdrawals/payouts
// are a separate future feature)
// ========================================

async function ensureWalletTransactionsTableExists() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS wallet_transactions (
                id SERIAL PRIMARY KEY,
                seller_id INTEGER REFERENCES sellers(id),
                type TEXT NOT NULL,
                amount NUMERIC(12, 2) NOT NULL,
                description TEXT,
                order_id INTEGER,
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Wallet transactions table is ready."
        );

    } catch (error) {

        console.error(
            "Could not create wallet transactions table:",
            error.message
        );

    }

}


// ========================================
// PRODUCT REVIEWS
// (only from students who actually bought
// the product — checked at submit time, not
// enforced by a foreign key, since "did they
// buy it" is a computed fact, not a stored one)
// ========================================

async function ensureReviewsTableExists() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS reviews (
                id SERIAL PRIMARY KEY,
                product_id INTEGER REFERENCES products(id),
                student_id INTEGER REFERENCES students(id),
                order_id INTEGER,
                rating INTEGER NOT NULL,
                comment TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (product_id, student_id)
            )
            `
        );

        console.log(
            "Reviews table is ready."
        );

    } catch (error) {

        console.error(
            "Could not create reviews table:",
            error.message
        );

    }

}


// ========================================
// WISHLIST
// ========================================

async function ensureWishlistTableExists() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS wishlist_items (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES students(id),
                product_id INTEGER REFERENCES products(id),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (student_id, product_id)
            )
            `
        );

        console.log(
            "Wishlist table is ready."
        );

    } catch (error) {

        console.error(
            "Could not create wishlist table:",
            error.message
        );

    }

}


// ========================================
// BLOCK / REPORT
// ========================================

async function ensureBlockAndReportTablesExist() {

    try {

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS blocked_students (
                id SERIAL PRIMARY KEY,
                blocker_id INTEGER REFERENCES students(id),
                blocked_id INTEGER REFERENCES students(id),
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (blocker_id, blocked_id)
            )
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS reports (
                id SERIAL PRIMARY KEY,
                reporter_id INTEGER REFERENCES students(id),
                reported_id INTEGER REFERENCES students(id),
                reason TEXT NOT NULL,
                details TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        console.log(
            "Block and report tables are ready."
        );

    } catch (error) {

        console.error(
            "Could not create block/report tables:",
            error.message
        );

    }

}


// ========================================
// ERRANDS
// ========================================

async function ensureErrandsSchemaExists() {

    try {

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_mode_available BOOLEAN DEFAULT false
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_available_until TIMESTAMP
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_service_area TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_completed_count INTEGER DEFAULT 0
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_cancelled_count INTEGER DEFAULT 0
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_rating_total INTEGER DEFAULT 0
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_rating_count INTEGER DEFAULT 0
            `
        );

        await pool.query(
            `
            ALTER TABLE errands
            ADD COLUMN IF NOT EXISTS item_cost_status TEXT DEFAULT 'none'
            `
        );

        await pool.query(
            `
            ALTER TABLE errands
            ADD COLUMN IF NOT EXISTS item_cost_payment_reference TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE errands
            ADD COLUMN IF NOT EXISTS item_cost_payment_gateway TEXT
            `
        );

        await pool.query(
            `
            ALTER TABLE errands
            ADD COLUMN IF NOT EXISTS is_shop_delivery BOOLEAN DEFAULT false
            `
        );

        await pool.query(
            `
            ALTER TABLE errands
            ADD COLUMN IF NOT EXISTS order_id INTEGER
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS is_errand_agent_registered BOOLEAN DEFAULT false
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_agent_registered_at TIMESTAMP
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_agent_phone_verified BOOLEAN DEFAULT false
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_agent_payment_reference TEXT
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS phone_verification_codes (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES students(id),
                phone TEXT NOT NULL,
                code TEXT NOT NULL,
                purpose TEXT NOT NULL DEFAULT 'errand_agent',
                expires_at TIMESTAMP NOT NULL,
                verified_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        await pool.query(
            `
            ALTER TABLE students
            ADD COLUMN IF NOT EXISTS errand_agent_payment_gateway TEXT
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS craft_providers (
                id SERIAL PRIMARY KEY,
                student_id INTEGER REFERENCES students(id) UNIQUE,
                skills JSONB NOT NULL DEFAULT '[]'::jsonb,
                bio TEXT,
                status TEXT NOT NULL DEFAULT 'pending',
                payment_reference TEXT UNIQUE,
                payment_gateway TEXT,
                registered_at TIMESTAMP DEFAULT NOW()
            )
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS craft_requests (
                id SERIAL PRIMARY KEY,
                request_code TEXT UNIQUE,
                student_id INTEGER REFERENCES students(id),
                skill TEXT NOT NULL,
                description TEXT,
                location TEXT NOT NULL,
                proposed_price NUMERIC(12, 2) NOT NULL,
                agreed_price NUMERIC(12, 2),
                kurios_commission NUMERIC(12, 2),
                provider_earnings NUMERIC(12, 2),
                status TEXT NOT NULL DEFAULT 'open',
                payment_status TEXT NOT NULL DEFAULT 'unpaid',
                assigned_provider_id INTEGER REFERENCES students(id),
                payment_reference TEXT UNIQUE,
                payment_gateway TEXT,
                transaction_reference TEXT,
                conversation_id INTEGER REFERENCES conversations(id),
                delivery_otp TEXT,
                rating INTEGER,
                rating_comment TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                assigned_at TIMESTAMP,
                completed_at TIMESTAMP,
                cancelled_at TIMESTAMP
            )
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS craft_offers (
                id SERIAL PRIMARY KEY,
                request_id INTEGER REFERENCES craft_requests(id),
                provider_id INTEGER REFERENCES students(id),
                offered_price NUMERIC(12, 2) NOT NULL,
                is_counter BOOLEAN NOT NULL DEFAULT false,
                status TEXT NOT NULL DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE (request_id, provider_id)
            )
            `
        );

        await pool.query(
            `
            CREATE INDEX IF NOT EXISTS idx_craft_requests_status
            ON craft_requests (status)
            `
        );

        await pool.query(
            `
            CREATE TABLE IF NOT EXISTS errands (
                id SERIAL PRIMARY KEY,
                errand_code TEXT UNIQUE,
                student_id INTEGER REFERENCES students(id),
                agent_id INTEGER REFERENCES students(id),
                title TEXT NOT NULL,
                pickup_location TEXT NOT NULL,
                destination TEXT NOT NULL,
                description TEXT,
                item_cost NUMERIC(12, 2) DEFAULT 0,
                errand_fee NUMERIC(12, 2) NOT NULL,
                total_amount NUMERIC(12, 2) NOT NULL,
                kurios_commission NUMERIC(12, 2) NOT NULL,
                agent_earnings NUMERIC(12, 2) NOT NULL,
                status TEXT NOT NULL DEFAULT 'pending',
                payment_reference TEXT UNIQUE,
                transaction_reference TEXT,
                payment_gateway TEXT,
                delivery_otp TEXT,
                conversation_id INTEGER REFERENCES conversations(id),
                rating INTEGER,
                rating_comment TEXT,
                cancellation_reason TEXT,
                created_at TIMESTAMP DEFAULT NOW(),
                accepted_at TIMESTAMP,
                started_at TIMESTAMP,
                picked_up_at TIMESTAMP,
                on_way_at TIMESTAMP,
                arrived_at TIMESTAMP,
                completed_at TIMESTAMP,
                cancelled_at TIMESTAMP
            )
            `
        );

        await pool.query(
            `
            CREATE INDEX IF NOT EXISTS idx_errands_status
            ON errands (status)
            `
        );

        await pool.query(
            `
            CREATE INDEX IF NOT EXISTS idx_errands_student_id
            ON errands (student_id)
            `
        );

        await pool.query(
            `
            CREATE INDEX IF NOT EXISTS idx_errands_agent_id
            ON errands (agent_id)
            `
        );

        console.log(
            "Errands schema is ready."
        );

    } catch (error) {

        console.error(
            "Could not set up errands schema:",
            error.message
        );

    }

}


// ========================================
// RUN ALL MIGRATIONS, IN ORDER
// ========================================

/*
    These run one after another (not all at
    once) because later ones depend on earlier
    ones — the orders table references students,
    and the profile columns are added onto
    students, so students has to exist first.
*/

async function runMigrations() {

    await ensureBaseTablesExist();
    await ensureProfileColumnsExist();
    await ensureOrdersTableExists();
    await ensureSellersTableExists();
    await ensureSellerPaymentColumnsExist();
    await ensureAdminTablesExist();
    await ensureAdminUsernameColumnExists();
    await seedInitialAdmin();
    await ensureNotificationsTableExists();
    await ensureProductSellerColumnsExist();
    await seedKuriosStoresSeller();
    await ensureMessagesTableExists();
    await ensureConversationsSchemaExists();
    await ensureKSupportSystemAccount();
    await ensureWalletTransactionsTableExists();
    await ensureReviewsTableExists();
    await ensureWishlistTableExists();
    await ensureBlockAndReportTablesExist();
    await ensureErrandsSchemaExists();

}


// ========================================
// HOME ROUTE
// ========================================

app.get("/", (req, res) => {

    res.send("Kurios Stores Backend is Working!");

});


// ========================================
// GET PRODUCTS
// ========================================

app.get("/api/products", async (req, res) => {

    try {

        const result = await pool.query(
            `
            SELECT
                products.*,
                sellers.store_name AS seller_store_name,
                COALESCE(review_stats.avg_rating, 0) AS avg_rating,
                COALESCE(review_stats.review_count, 0) AS review_count
            FROM products
            LEFT JOIN sellers ON sellers.id = products.seller_id
            LEFT JOIN (
                SELECT
                    product_id,
                    ROUND(AVG(rating)::numeric, 1) AS avg_rating,
                    COUNT(*) AS review_count
                FROM reviews
                GROUP BY product_id
            ) AS review_stats ON review_stats.product_id = products.id
            WHERE products.is_active = true
            ORDER BY products.id ASC
            `
        );

        res.json(
            result.rows.map(function (product) {

                const effectivePrice =
                    getEffectivePrice(product);

                return Object.assign({}, product, {
                    effective_price: effectivePrice,
                    is_on_sale: effectivePrice < Number(product.price)
                });

            })
        );

    } catch (error) {

        console.error(
            "Error fetching products:",
            error.message
        );

        res.status(500).json({
            error: "Unable to retrieve products"
        });

    }

});


// ========================================
// WISHLIST
// ========================================

app.post("/api/wishlist/toggle", async (req, res) => {

    try {

        const { studentId, productId } = req.body;

        if (!studentId || !productId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId or productId."
            });

        }

        const existing = await pool.query(
            `SELECT id FROM wishlist_items WHERE student_id = $1 AND product_id = $2 LIMIT 1`,
            [studentId, productId]
        );

        if (existing.rows.length > 0) {

            await pool.query(
                `DELETE FROM wishlist_items WHERE id = $1`,
                [existing.rows[0].id]
            );

            return res.status(200).json({
                success: true,
                inWishlist: false
            });

        }

        await pool.query(
            `INSERT INTO wishlist_items (student_id, product_id) VALUES ($1, $2)`,
            [studentId, productId]
        );

        res.status(200).json({
            success: true,
            inWishlist: true
        });

    } catch (error) {

        console.error(
            "Toggle wishlist error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not update your wishlist."
        });

    }

});

app.get("/api/wishlist", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `
            SELECT
                wishlist_items.id AS wishlist_item_id,
                wishlist_items.created_at AS wishlisted_at,
                products.*,
                sellers.store_name AS seller_store_name,
                (
                    SELECT ROUND(AVG(rating), 1) FROM reviews WHERE product_id = products.id
                ) AS avg_rating,
                (
                    SELECT COUNT(*) FROM reviews WHERE product_id = products.id
                ) AS review_count
            FROM wishlist_items
            JOIN products ON products.id = wishlist_items.product_id
            LEFT JOIN sellers ON sellers.id = products.seller_id
            WHERE wishlist_items.student_id = $1
            ORDER BY wishlist_items.created_at DESC
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            items: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch wishlist error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your wishlist."
        });

    }

});

app.get("/api/wishlist/ids", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `SELECT product_id FROM wishlist_items WHERE student_id = $1`,
            [studentId]
        );

        res.status(200).json({
            success: true,
            productIds: result.rows.map(function (r) { return r.product_id; })
        });

    } catch (error) {

        console.error(
            "Fetch wishlist ids error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your wishlist."
        });

    }

});


// ========================================
// BLOCK / UNBLOCK / REPORT
// ========================================

app.post("/api/students/block", async (req, res) => {

    try {

        const { studentId, blockedId } = req.body;

        if (!studentId || !blockedId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId or blockedId."
            });

        }

        if (String(studentId) === String(blockedId)) {

            return res.status(400).json({
                success: false,
                message: "You can't block yourself."
            });

        }

        await pool.query(
            `
            INSERT INTO blocked_students (blocker_id, blocked_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            `,
            [studentId, blockedId]
        );

        res.status(200).json({
            success: true,
            message: "Student blocked."
        });

    } catch (error) {

        console.error(
            "Block student error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not block this student."
        });

    }

});

app.post("/api/students/unblock", async (req, res) => {

    try {

        const { studentId, blockedId } = req.body;

        if (!studentId || !blockedId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId or blockedId."
            });

        }

        await pool.query(
            `DELETE FROM blocked_students WHERE blocker_id = $1 AND blocked_id = $2`,
            [studentId, blockedId]
        );

        res.status(200).json({
            success: true,
            message: "Student unblocked."
        });

    } catch (error) {

        console.error(
            "Unblock student error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not unblock this student."
        });

    }

});

app.get("/api/students/blocked", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `
            SELECT
                blocked_students.blocked_id,
                students.first_name,
                students.last_name,
                blocked_students.created_at
            FROM blocked_students
            JOIN students ON students.id = blocked_students.blocked_id
            WHERE blocked_students.blocker_id = $1
            ORDER BY blocked_students.created_at DESC
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            blocked: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch blocked students error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your blocked list."
        });

    }

});

app.post("/api/students/report", async (req, res) => {

    try {

        const { studentId, reportedId, reason, details } = req.body;

        if (!studentId || !reportedId || !reason) {

            return res.status(400).json({
                success: false,
                message: "Please select a reason for your report."
            });

        }

        if (String(studentId) === String(reportedId)) {

            return res.status(400).json({
                success: false,
                message: "You can't report yourself."
            });

        }

        const result = await pool.query(
            `
            INSERT INTO reports (reporter_id, reported_id, reason, details)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [studentId, reportedId, reason, details || null]
        );

        res.status(201).json({
            success: true,
            report: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Submit report error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not submit your report."
        });

    }

});


// ========================================
// ADMIN — VIEW REPORTS
// ========================================

app.get("/api/admin/reports", requireAdminAuth, async (req, res) => {

    try {

        const { status } = req.query;

        const result = await pool.query(
            `
            SELECT
                reports.*,
                reporter.first_name AS reporter_first_name,
                reporter.last_name AS reporter_last_name,
                reported.first_name AS reported_first_name,
                reported.last_name AS reported_last_name
            FROM reports
            JOIN students AS reporter ON reporter.id = reports.reporter_id
            JOIN students AS reported ON reported.id = reports.reported_id
            ${status ? "WHERE reports.status = $1" : ""}
            ORDER BY reports.created_at DESC
            `,
            status ? [status] : []
        );

        res.status(200).json({
            success: true,
            reports: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch admin reports error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load reports."
        });

    }

});

app.post("/api/admin/reports/:id/resolve", requireAdminAuth, async (req, res) => {

    try {

        const { id } = req.params;

        const result = await pool.query(
            `UPDATE reports SET status = 'reviewed' WHERE id = $1 RETURNING *`,
            [id]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Report not found."
            });

        }

        res.status(200).json({
            success: true,
            report: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Resolve report error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not update this report."
        });

    }

});


app.post("/api/students/register", async (req, res) => {

    try {

        const {
            firstName,
            lastName,
            email,
            phone,
            whatsappNumber,
            university,
            studentId,
            passcode,
            confirmPasscode,
            agreedStudent,
            agreedTerms,
            agreedPrivacy,
            receiveNotifications
        } = req.body;


        // ====================================
        // REQUIRED FIELD VALIDATION
        // ====================================

        if (
            !firstName ||
            !lastName ||
            !email ||
            !phone ||
            !whatsappNumber ||
            !university ||
            !studentId ||
            !passcode ||
            !confirmPasscode
        ) {

            return res.status(400).json({
                success: false,
                message: "Please fill in all required fields."
            });

        }


        // ====================================
        // PASSCODE FORMAT
        // ====================================

        if (!/^\d{6}$/.test(passcode)) {

            return res.status(400).json({
                success: false,
                message: "Your passcode must be exactly 6 digits."
            });

        }


        // ====================================
        // PHONE NUMBER FORMAT
        // ====================================

        const digitsOnlyPhone =
            phone.replace(/\D/g, "");

        if (!/^0\d{10}$/.test(digitsOnlyPhone)) {

            return res.status(400).json({
                success: false,
                message: "Please enter a complete, valid phone number (11 digits, starting with 0)."
            });

        }


        // ====================================
        // WHATSAPP NUMBER FORMAT
        // ====================================

        const digitsOnlyWhatsapp =
            whatsappNumber.replace(/\D/g, "");

        if (!/^0\d{10}$/.test(digitsOnlyWhatsapp)) {

            return res.status(400).json({
                success: false,
                message: "Please enter a complete, valid WhatsApp number (11 digits, starting with 0)."
            });

        }


        // ====================================
        // PASSCODE MATCH
        // ====================================

        if (passcode !== confirmPasscode) {

            return res.status(400).json({
                success: false,
                message: "Passcodes do not match."
            });

        }


        // ====================================
        // STUDENT CONFIRMATION
        // ====================================

        if (!agreedStudent) {

            return res.status(400).json({
                success: false,
                message: "Please confirm that you are a student."
            });

        }


        // ====================================
        // TERMS & PRIVACY
        // ====================================

        if (!agreedTerms || !agreedPrivacy) {

            return res.status(400).json({
                success: false,
                message:
                    "You must agree to the Terms and Privacy Policy."
            });

        }


        // ====================================
// CHECK EXISTING EMAIL
// ====================================

const emailCheck = await pool.query(
    `
    SELECT
        id,
        first_name,
        last_name,
        email,
        phone,
        whatsapp_number,
        university,
        student_id,
        password_hash,
        agreed_terms,
        agreed_privacy,
        receive_notifications,
        email_verified
    FROM students
    WHERE LOWER(email) = LOWER($1)
    LIMIT 1
    `,
    [email.trim()]
);


// ====================================
// EXISTING EMAIL FOUND
// ====================================

if (emailCheck.rows.length > 0) {

    const existingStudent =
        emailCheck.rows[0];


    // ====================================
    // VERIFIED ACCOUNT ALREADY EXISTS
    // ====================================

    if (existingStudent.email_verified) {

        return res.status(409).json({

            success: false,

            message:
                "An account with this email already exists. Please log in instead."

        });

    }


    // ====================================
    // UNVERIFIED REGISTRATION
    // ====================================

    console.log(
        "Unverified registration found. Continuing registration:",
        existingStudent.email
    );


    // ====================================
    // CHECK STUDENT ID
    // AGAINST OTHER ACCOUNTS
    // ====================================

    const studentIdCheck =
        await pool.query(
            `
            SELECT id
            FROM students
            WHERE university = $1
            AND student_id = $2
            AND id <> $3
            LIMIT 1
            `,
            [
                university.trim(),
                studentId.trim(),
                existingStudent.id
            ]
        );


    if (studentIdCheck.rows.length > 0) {

        return res.status(409).json({

            success: false,

            message:
                "This student ID is already registered for this institution."

        });

    }


    // ====================================
    // HASH NEW PASSCODE
    // ====================================

    const passwordHash =
        await bcrypt.hash(
            passcode,
            12
        );


    // ====================================
    // UPDATE PENDING REGISTRATION
    // ====================================

    const updatedStudent =
        await pool.query(
            `
            UPDATE students
            SET
                first_name = $1,
                last_name = $2,
                phone = $3,
                whatsapp_number = $4,
                university = $5,
                student_id = $6,
                password_hash = $7,
                agreed_terms = $8,
                agreed_privacy = $9,
                receive_notifications = $10,
                email_verified = false,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $11
            RETURNING
                id,
                first_name,
                last_name,
                email,
                phone,
                whatsapp_number,
                university,
                student_id,
                date_of_birth,
                profile_picture
            `,
            [
                firstName.trim(),
                lastName.trim(),
                phone.trim(),
                whatsappNumber
                    ? whatsappNumber.trim()
                    : null,
                university.trim(),
                studentId.trim(),
                passwordHash,
                agreedTerms,
                agreedPrivacy,
                receiveNotifications !== false,
                existingStudent.id
            ]
        );


    // ====================================
    // GENERATE NEW OTP
    // ====================================

    const otp =
        crypto
            .randomInt(
                100000,
                1000000
            )
            .toString();


    const expiresAt =
        new Date(
            Date.now() +
            10 * 60 * 1000
        );


    // ====================================
    // REMOVE OLD OTP
    // ====================================

    await pool.query(
        `
        DELETE FROM student_verification_codes
        WHERE student_id = $1
        AND verified = false
        `,
        [
            existingStudent.id
        ]
    );


    // ====================================
    // SAVE NEW OTP
    // ====================================

    await pool.query(
        `
        INSERT INTO student_verification_codes
        (
            student_id,
            otp,
            expires_at
        )
        VALUES
        ($1, $2, $3)
        `,
        [
            existingStudent.id,
            otp,
            expiresAt
        ]
    );


    // ====================================
    // SEND NEW VERIFICATION EMAIL
    // ====================================

    await sendEmail({

        to:
            updatedStudent.rows[0].email,

        subject:
            "Continue Your Kurios Stores Registration",

        html: `
            <div style="
                font-family: Arial, sans-serif;
                max-width: 600px;
                margin: 0 auto;
                padding: 30px;
                border: 1px solid #e5e7eb;
                border-radius: 12px;
            ">

                <h2 style="
                    color: #5b21b6;
                ">
                    Continue Your Kurios Stores Registration
                </h2>

                <p>
                    Hello
                    <strong>
                        ${updatedStudent.rows[0].first_name}
                    </strong>,
                </p>

                <p>
                    We found an unfinished Kurios Stores
                    registration using this email address.
                </p>

                <p>
                    You can continue your registration.
                    Enter the verification code below
                    to activate your account.
                </p>

                <div style="
                    margin: 25px 0;
                    padding: 20px;
                    text-align: center;
                    background: #f3f0ff;
                    border-radius: 10px;
                ">

                    <span style="
                        font-size: 32px;
                        font-weight: bold;
                        letter-spacing: 8px;
                        color: #5b21b6;
                    ">
                        ${otp}
                    </span>

                </div>

                <p>
                    This verification code will expire
                    in <strong>10 minutes</strong>.
                </p>

                <p>
                    If you did not attempt to register
                    with Kurios Stores, you can ignore
                    this email.
                </p>

                <br>

                <p>
                    Regards,<br>
                    <strong>Kurios Stores</strong>
                </p>

            </div>
        `

    });


    // ====================================
    // CONTINUE REGISTRATION
    // ====================================

    return res.status(200).json({

        success: true,

        requiresVerification: true,

        continueRegistration: true,

        message:
            "We found an unfinished registration for this email. Your registration has been continued and a new verification code has been sent.",

        studentId:
            updatedStudent.rows[0].id,

        email:
            updatedStudent.rows[0].email,

        student:
            updatedStudent.rows[0]

    });

}


        // ====================================
        // CHECK STUDENT ID
        // ====================================

        const studentCheck = await pool.query(
            `
            SELECT id
            FROM students
            WHERE university = $1
            AND student_id = $2
            `,
            [
                university.trim(),
                studentId.trim()
            ]
        );

        if (studentCheck.rows.length > 0) {

            return res.status(409).json({
                success: false,
                message:
                    "This student ID is already registered for this institution."
            });

        }


        // ====================================
        // HASH PASSCODE
        // ====================================

        const passwordHash = await bcrypt.hash(
            passcode,
            12
        );


        // ====================================
        // SAVE STUDENT
        // ====================================

        const result = await pool.query(
            `
            INSERT INTO students (
                first_name,
                last_name,
                email,
                phone,
                whatsapp_number,
                university,
                student_id,
                password_hash,
                agreed_terms,
                agreed_privacy,
                receive_notifications,
                email_verified
            )
            VALUES (
                $1,
                $2,
                $3,
                $4,
                $5,
                $6,
                $7,
                $8,
                $9,
                $10,
                $11,
                false
            )
            RETURNING
                id,
                first_name,
                last_name,
                email,
                phone,
                whatsapp_number,
                university,
                student_id,
                date_of_birth,
                profile_picture,
                created_at
            `,
            [
                firstName.trim(),
                lastName.trim(),
                email.trim(),
                digitsOnlyPhone,
                digitsOnlyWhatsapp,
                university.trim(),
                studentId.trim(),
                passwordHash,
                agreedTerms,
                agreedPrivacy,
                receiveNotifications !== false
            ]
        );


// ====================================
// GENERATE EMAIL VERIFICATION OTP
// ====================================

const otp = crypto
    .randomInt(100000, 1000000)
    .toString();

const expiresAt = new Date(
    Date.now() + 10 * 60 * 1000
);


// ====================================
// REMOVE OLD OTP CODES
// ====================================

await pool.query(
    `
    DELETE FROM student_verification_codes
    WHERE student_id = $1
    AND verified = false
    `,
    [result.rows[0].id]
);


// ====================================
// SAVE NEW OTP
// ====================================

await pool.query(
    `
    INSERT INTO student_verification_codes
    (
        student_id,
        otp,
        expires_at
    )
    VALUES
    ($1, $2, $3)
    `,
    [
        result.rows[0].id,
        otp,
        expiresAt
    ]
);


// ====================================
// SEND VERIFICATION EMAIL
// ====================================

await sendEmail({

    to: result.rows[0].email,

    subject: "Verify Your Kurios Stores Account",

    html: `
        <div style="
            font-family: Arial, sans-serif;
            max-width: 600px;
            margin: 0 auto;
            padding: 30px;
            border: 1px solid #e5e7eb;
            border-radius: 12px;
        ">

            <h2 style="color: #5b21b6;">
                Welcome to Kurios Stores
            </h2>

            <p>
                Hello <strong>${result.rows[0].first_name}</strong>,
            </p>

            <p>
                Thank you for creating your Kurios Stores
                student account.
            </p>

            <p>
                To activate your account, enter the
                verification code below:
            </p>

            <div style="
                margin: 25px 0;
                padding: 20px;
                text-align: center;
                background: #f3f0ff;
                border-radius: 10px;
            ">

                <span style="
                    font-size: 32px;
                    font-weight: bold;
                    letter-spacing: 8px;
                    color: #5b21b6;
                ">
                    ${otp}
                </span>

            </div>

            <p>
                This verification code will expire in
                <strong>10 minutes</strong>.
            </p>

            <p>
                If you did not create this account,
                please ignore this email.
            </p>

            <br>

            <p>
                Regards,<br>
                <strong>Kurios Stores</strong>
            </p>

        </div>
    `

});


// ====================================
// REGISTRATION SUCCESS
// ====================================

res.status(201).json({

    success: true,

    message:
        "Account created successfully. Please check your email for the verification code.",

    requiresVerification: true,

    studentId: result.rows[0].id,

    email: result.rows[0].email

});

    } catch (error) {

        console.error(
            "Registration error:",
            error.message
        );

        res.status(500).json({

            success: false,

            message:
                "Something went wrong while creating the account."

        });

    }

});

// ========================================
// VERIFY STUDENT EMAIL OTP
// ========================================

app.post("/api/students/verify-otp", async (req, res) => {

    try {

        const {
            studentId,
            otp
        } = req.body;


        // ====================================
        // VALIDATE INPUT
        // ====================================

        if (!studentId || !otp) {

            return res.status(400).json({
                success: false,
                message: "Student ID and verification code are required."
            });

        }


        // ====================================
        // FIND OTP
        // ====================================

        const otpResult = await pool.query(
            `
            SELECT
                id,
                student_id,
                otp,
                expires_at,
                verified
            FROM student_verification_codes
            WHERE student_id = $1
            AND otp = $2
            AND verified = false
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [
                studentId,
                otp.toString().trim()
            ]
        );


        // ====================================
        // INVALID OTP
        // ====================================

        if (otpResult.rows.length === 0) {

            return res.status(400).json({
                success: false,
                message: "Invalid verification code."
            });

        }


        const verificationCode = otpResult.rows[0];


        // ====================================
        // CHECK EXPIRATION
        // ====================================

        if (
            new Date(verificationCode.expires_at) < new Date()
        ) {

            return res.status(400).json({
                success: false,
                message: "This verification code has expired. Please request a new code."
            });

        }


        // ====================================
        // MARK OTP AS VERIFIED
        // ====================================

        await pool.query(
            `
            UPDATE student_verification_codes
            SET verified = true
            WHERE id = $1
            `,
            [verificationCode.id]
        );


        // ====================================
        // VERIFY STUDENT EMAIL
        // ====================================

        const studentResult = await pool.query(
            `
            UPDATE students
            SET email_verified = true,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING
                id,
                first_name,
                last_name,
                email,
                phone,
                whatsapp_number,
                university,
                student_id,
                date_of_birth,
                profile_picture,
                email_verified
            `,
            [studentId]
        );


        // ====================================
        // SUCCESS
        // ====================================

        if (studentResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student account could not be found."
            });

        }


        res.status(200).json({

            success: true,

            message:
                "Email verified successfully. Your Kurios Stores account is now active.",

            student: studentResult.rows[0]

        });

    } catch (error) {

        console.error(
            "OTP verification error:",
            error.message
        );

        res.status(500).json({

            success: false,

            message:
                "Something went wrong while verifying your account."

        });

    }

});


// ========================================
// RESEND STUDENT EMAIL OTP
// ========================================

app.post("/api/students/resend-otp", async (req, res) => {

    try {

        const {
            studentId,
            email
        } = req.body;


        // ====================================
        // VALIDATE INPUT
        // ====================================

        if (!studentId || !email) {

            return res.status(400).json({

                success: false,

                message:
                    "Student ID and email are required."

            });

        }


        // ====================================
        // FIND STUDENT
        // ====================================

        const studentResult = await pool.query(
            `
            SELECT
                id,
                first_name,
                email,
                email_verified
            FROM students
            WHERE id = $1
            AND LOWER(email) = LOWER($2)
            LIMIT 1
            `,
            [
                studentId,
                email.trim()
            ]
        );


        // ====================================
        // STUDENT NOT FOUND
        // ====================================

        if (studentResult.rows.length === 0) {

            return res.status(404).json({

                success: false,

                message:
                    "Student account could not be found."

            });

        }


        const student =
            studentResult.rows[0];

            console.log("LOGIN USER FOUND:", student.email);


        // ====================================
        // CHECK IF ALREADY VERIFIED
        // ====================================

        if (student.email_verified) {

            return res.status(400).json({

                success: false,

                message:
                    "This student account has already been verified."

            });

        }


        // ====================================
        // GENERATE NEW OTP
        // ====================================

        const otp =
            crypto
                .randomInt(
                    100000,
                    1000000
                )
                .toString();


        // ====================================
        // OTP EXPIRATION
        // ====================================

        const expiresAt =
            new Date(
                Date.now() +
                10 * 60 * 1000
            );


        // ====================================
        // REMOVE OLD OTP
        // ====================================

        await pool.query(
            `
            DELETE FROM student_verification_codes
            WHERE student_id = $1
            AND verified = false
            `,
            [
                student.id
            ]
        );


        // ====================================
        // SAVE NEW OTP
        // ====================================

        await pool.query(
            `
            INSERT INTO student_verification_codes
            (
                student_id,
                otp,
                expires_at
            )
            VALUES
            ($1, $2, $3)
            `,
            [
                student.id,
                otp,
                expiresAt
            ]
        );


        // ====================================
        // SEND NEW OTP EMAIL
        // ====================================

        await sendEmail({

            to:
                student.email,

            subject:
                "Your New Kurios Stores Verification Code",

            html: `
                <div style="
                    font-family: Arial, sans-serif;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 30px;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                ">

                    <h2 style="color: #5b21b6;">
                        Kurios Stores
                    </h2>

                    <p>
                        Hello
                        <strong>${student.first_name}</strong>,
                    </p>

                    <p>
                        Here is your new email
                        verification code:
                    </p>

                    <div style="
                        margin: 25px 0;
                        padding: 20px;
                        text-align: center;
                        background: #f3f0ff;
                        border-radius: 10px;
                    ">

                        <span style="
                            font-size: 32px;
                            font-weight: bold;
                            letter-spacing: 8px;
                            color: #5b21b6;
                        ">
                            ${otp}
                        </span>

                    </div>

                    <p>
                        This verification code will expire
                        in <strong>10 minutes</strong>.
                    </p>

                    <p>
                        If you did not request a new code,
                        please ignore this email.
                    </p>

                    <br>

                    <p>
                        Regards,<br>
                        <strong>Kurios Stores</strong>
                    </p>

                </div>
            `

        });


        // ====================================
        // RESEND SUCCESS
        // ====================================

        res.status(200).json({

            success: true,

            message:
                "A new verification code has been sent to your email."

        });


    } catch (error) {

        console.error(
            "Resend OTP error:",
            error.message
        );


        res.status(500).json({

            success: false,

            message:
                "Something went wrong while sending a new verification code."

        });

    }

});


// ========================================
// STUDENT LOGIN
// ========================================

app.post("/api/students/login", async (req, res) => {

    try {

        const {
            identifier,
            passcode
        } = req.body;


        // ========================================
        // VALIDATE INPUT
        // ========================================

        if (!identifier || !passcode) {

            return res.status(400).json({
                success: false,
                message: "Email/phone and passcode are required."
            });

        }


        // ========================================
        // FIND STUDENT — BY EMAIL OR PHONE
        // (phone is compared digits-only, so
        // spaces/dashes/brackets don't matter)
        // ========================================

        const studentResult = await pool.query(
            `
            SELECT
                id,
                first_name,
                last_name,
                email,
                phone,
                whatsapp_number,
                university,
                student_id,
                date_of_birth,
                profile_picture,
                password_hash,
                email_verified,
                is_suspended,
                is_support
            FROM students
            WHERE
                LOWER(email) = LOWER($1)
                OR RIGHT(regexp_replace(phone, '\\D', '', 'g'), 10) =
                   RIGHT(regexp_replace($1, '\\D', '', 'g'), 10)
            LIMIT 1
            `,
            [
                identifier.trim()
            ]
        );


        // ========================================
        // ACCOUNT NOT FOUND
        // ========================================

        if (studentResult.rows.length === 0) {

            return res.status(401).json({
                success: false,
                message: "Invalid email/phone or passcode."
            });

        }


        const student =
            studentResult.rows[0];


        // ========================================
        // CHECK SUSPENSION
        // ========================================

        if (student.is_suspended) {

            return res.status(403).json({
                success: false,
                message:
                    "Your account has been suspended. Contact Kurios Stores support for details."
            });

        }


        // ========================================
        // CHECK EMAIL VERIFICATION
        // ========================================

        if (!student.email_verified) {

            return res.status(403).json({
                success: false,
                message:
                    "Your email has not been verified. Please complete email verification before signing in.",
                requiresVerification: true,
                studentId: student.id,
                email: student.email
            });

        }


        // ========================================
        // CHECK PASSCODE
        // ========================================

        const passcodeMatches =
            await bcrypt.compare(
                passcode,
                student.password_hash
            );


        if (!passcodeMatches) {

            return res.status(401).json({
                success: false,
                message: "Invalid email/phone or passcode."
            });

        }


        // ========================================
        // SUCCESSFUL LOGIN
        // ========================================

        const {
            password_hash,
            ...safeStudent
        } = student;


        return res.status(200).json({

            success: true,

            message:
                "Login successful. Welcome back to Kurios Stores.",

            student: safeStudent

        });


    } catch (error) {

        console.error(
            "Student login error:",
            error.message
        );


        return res.status(500).json({

            success: false,

            message:
                "Something went wrong while signing you in."

        });

    }

});


// ========================================
// REQUEST A PASSCODE RESET
// (sends an OTP to the student's email)
// ========================================

app.post("/api/students/request-passcode-reset", async (req, res) => {

    try {

        const { email } = req.body;

        if (!email) {

            return res.status(400).json({
                success: false,
                message: "Please enter your email address."
            });

        }


        // ====================================
        // FIND STUDENT
        // ====================================

        const studentResult = await pool.query(
            `
            SELECT id, first_name, email
            FROM students
            WHERE LOWER(email) = LOWER($1)
            LIMIT 1
            `,
            [email.trim()]
        );

        if (studentResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "We couldn't find a Kurios Stores account with that email."
            });

        }

        const student = studentResult.rows[0];


        // ====================================
        // GENERATE OTP
        // ====================================

        const otp =
            crypto.randomInt(100000, 1000000).toString();

        const expiresAt =
            new Date(Date.now() + 10 * 60 * 1000);


        // ====================================
        // REMOVE OLD OTPs, SAVE NEW ONE
        // ====================================

        await pool.query(
            `
            DELETE FROM student_verification_codes
            WHERE student_id = $1
            AND verified = false
            `,
            [student.id]
        );

        await pool.query(
            `
            INSERT INTO student_verification_codes
            (student_id, otp, expires_at)
            VALUES ($1, $2, $3)
            `,
            [student.id, otp, expiresAt]
        );


        // ====================================
        // SEND RESET EMAIL
        // ====================================

        await sendEmail({

            to: student.email,

            subject: "Reset Your Kurios Stores Passcode",

            html: `
                <div style="
                    font-family: Arial, sans-serif;
                    max-width: 600px;
                    margin: 0 auto;
                    padding: 30px;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                ">

                    <h2 style="color: #5b21b6;">
                        Reset Your Passcode
                    </h2>

                    <p>
                        Hello <strong>${student.first_name}</strong>,
                    </p>

                    <p>
                        Use the code below to set a new 6-digit
                        passcode for your Kurios Stores account.
                    </p>

                    <div style="
                        margin: 25px 0;
                        padding: 20px;
                        text-align: center;
                        background: #f3f0ff;
                        border-radius: 10px;
                    ">
                        <span style="
                            font-size: 32px;
                            font-weight: bold;
                            letter-spacing: 8px;
                            color: #5b21b6;
                        ">
                            ${otp}
                        </span>
                    </div>

                    <p>
                        This code will expire in <strong>10 minutes</strong>.
                    </p>

                    <p>
                        If you did not request this, you can
                        safely ignore this email.
                    </p>

                    <br>

                    <p>
                        Regards,<br>
                        <strong>Kurios Stores</strong>
                    </p>

                </div>
            `

        });


        res.status(200).json({

            success: true,

            message: "A passcode reset code has been sent to your email.",

            studentId: student.id,

            email: student.email

        });

    } catch (error) {

        console.error(
            "Passcode reset request error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while requesting a passcode reset."
        });

    }

});


// ========================================
// CONFIRM A PASSCODE RESET
// (verifies the OTP and sets a new passcode)
// ========================================

app.post("/api/students/reset-passcode", async (req, res) => {

    try {

        const {
            studentId,
            otp,
            newPasscode,
            confirmNewPasscode
        } = req.body;

        if (
            !studentId ||
            !otp ||
            !newPasscode ||
            !confirmNewPasscode
        ) {

            return res.status(400).json({
                success: false,
                message: "Please fill in all fields."
            });

        }

        if (!/^\d{6}$/.test(newPasscode)) {

            return res.status(400).json({
                success: false,
                message: "Your new passcode must be exactly 6 digits."
            });

        }

        if (newPasscode !== confirmNewPasscode) {

            return res.status(400).json({
                success: false,
                message: "Passcodes do not match."
            });

        }


        // ====================================
        // FIND OTP
        // ====================================

        const otpResult = await pool.query(
            `
            SELECT id, expires_at
            FROM student_verification_codes
            WHERE student_id = $1
            AND otp = $2
            AND verified = false
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [studentId, otp.toString().trim()]
        );

        if (otpResult.rows.length === 0) {

            return res.status(400).json({
                success: false,
                message: "Invalid verification code."
            });

        }

        const verificationCode = otpResult.rows[0];

        if (new Date(verificationCode.expires_at) < new Date()) {

            return res.status(400).json({
                success: false,
                message: "This verification code has expired. Please request a new one."
            });

        }


        // ====================================
        // MARK OTP AS USED
        // ====================================

        await pool.query(
            `
            UPDATE student_verification_codes
            SET verified = true
            WHERE id = $1
            `,
            [verificationCode.id]
        );


        // ====================================
        // SET NEW PASSCODE
        // (can't reuse the current passcode or
        // any of the last 4 previous ones)
        // ====================================

        const currentStudentResult = await pool.query(
            `SELECT password_hash, passcode_history FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (currentStudentResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student account could not be found."
            });

        }

        const currentPasswordHash =
            currentStudentResult.rows[0].password_hash;

        const passcodeHistory =
            currentStudentResult.rows[0].passcode_history || [];

        const hashesToCheck =
            [currentPasswordHash, ...passcodeHistory].filter(Boolean);

        for (const oldHash of hashesToCheck) {

            const matchesOldPasscode =
                await bcrypt.compare(newPasscode, oldHash);

            if (matchesOldPasscode) {

                return res.status(400).json({
                    success: false,
                    message: "You can't reuse a recent passcode. Please choose one you haven't used in your last 4 passcodes."
                });

            }

        }

        const passwordHash =
            await bcrypt.hash(newPasscode, 12);

        const updatedHistory =
            [currentPasswordHash, ...passcodeHistory]
                .filter(Boolean)
                .slice(0, 4);

        const updatedStudent = await pool.query(
            `
            UPDATE students
            SET
                password_hash = $1,
                passcode_history = $2,
                email_verified = true,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING id, email
            `,
            [passwordHash, JSON.stringify(updatedHistory), studentId]
        );

        if (updatedStudent.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student account could not be found."
            });

        }

        res.status(200).json({

            success: true,

            message: "Your passcode has been reset. You can now sign in."

        });

    } catch (error) {

        console.error(
            "Passcode reset confirm error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while resetting your passcode."
        });

    }

});

app.post(
    "/api/students/update-profile",
    function (req, res, next) {

        // Run multer, but turn its errors into
        // the same JSON error shape as everywhere else.

        profilePictureUpload.single("profilePicture")(
            req,
            res,
            function (error) {

                if (error) {

                    return res.status(400).json({
                        success: false,
                        message: error.message
                    });

                }

                next();

            }
        );

    },
    async (req, res) => {

        try {

            const {
                studentId,
                phone,
                whatsappNumber,
                dateOfBirth
            } = req.body;


            // ====================================
            // VALIDATE INPUT
            // ====================================

            if (!studentId) {

                return res.status(400).json({
                    success: false,
                    message: "We couldn't tell which account to update."
                });

            }


            const newProfilePicturePath =
                req.file ?
                    "/uploads/" + req.file.filename :
                    null;


            if (
                !phone &&
                !whatsappNumber &&
                !dateOfBirth &&
                !newProfilePicturePath
            ) {

                return res.status(400).json({
                    success: false,
                    message: "Nothing was provided to update."
                });

            }


            // ====================================
            // LOOK UP THE CURRENT RECORD
            // (so we know the old picture to remove,
            // and to fall back to existing values)
            // ====================================

            const currentResult = await pool.query(
                `
                SELECT
                    id,
                    phone,
                    whatsapp_number,
                    date_of_birth,
                    profile_picture
                FROM students
                WHERE id = $1
                LIMIT 1
                `,
                [studentId]
            );

            if (currentResult.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "Student account could not be found."
                });

            }

            const currentStudent =
                currentResult.rows[0];


            // ====================================
            // UPDATE THE RECORD
            // ====================================

            const updatedResult = await pool.query(
                `
                UPDATE students
                SET
                    phone = $1,
                    whatsapp_number = $2,
                    date_of_birth = $3,
                    profile_picture = $4,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $5
                RETURNING
                    id,
                    first_name,
                    last_name,
                    email,
                    phone,
                    whatsapp_number,
                    university,
                    student_id,
                    date_of_birth,
                    profile_picture,
                    email_verified
                `,
                [
                    phone ?
                        phone.trim() :
                        currentStudent.phone,

                    whatsappNumber ?
                        whatsappNumber.trim() :
                        currentStudent.whatsapp_number,

                    dateOfBirth ?
                        dateOfBirth :
                        currentStudent.date_of_birth,

                    newProfilePicturePath ?
                        newProfilePicturePath :
                        currentStudent.profile_picture,

                    studentId
                ]
            );


            // ====================================
            // REMOVE THE OLD PROFILE PICTURE
            // (only once the new one is safely saved)
            // ====================================

            if (
                newProfilePicturePath &&
                currentStudent.profile_picture
            ) {

                const oldFilePath = path.join(
                    uploadsFolder,
                    path.basename(currentStudent.profile_picture)
                );

                fs.unlink(oldFilePath, function (error) {

                    if (error) {

                        console.error(
                            "Could not remove old profile picture:",
                            error.message
                        );

                    }

                });

            }


            // ====================================
            // SUCCESS
            // ====================================

            res.status(200).json({

                success: true,

                message: "Profile updated successfully.",

                student: updatedResult.rows[0]

            });

        } catch (error) {

            console.error(
                "Profile update error:",
                error.message
            );

            res.status(500).json({

                success: false,

                message:
                    "Something went wrong while updating your profile."

            });

        }

    }
);


// ========================================
// CHECKOUT + ORDERS (MONNIFY)
// ========================================

/*
    Recomputes the order total from the real
    products table — never trust a price sent
    from the browser.
*/

// ========================================
// EFFECTIVE PRICE OF A PRODUCT
// (accounts for an active discount window —
// shared by the products list, checkout, and
// anywhere else price needs to be correct)
// ========================================

function getEffectivePrice(product) {

    const originalPrice =
        Number(product.price);

    const hasDiscountValue =
        product.discount_price !== null &&
        product.discount_price !== undefined &&
        Number(product.discount_price) < originalPrice;

    if (!hasDiscountValue) {
        return originalPrice;
    }

    const now = new Date();

    const startsOk =
        !product.discount_starts_at ||
        new Date(product.discount_starts_at) <= now;

    const endsOk =
        !product.discount_ends_at ||
        new Date(product.discount_ends_at) >= now;

    if (startsOk && endsOk) {
        return Number(product.discount_price);
    }

    return originalPrice;

}


async function buildTrustedOrderItems(items) {

    const productIds =
        items.map(function (item) {
            return item.id;
        });

    const productsResult = await pool.query(
        `
        SELECT id, name, price, discount_price, discount_starts_at, discount_ends_at
        FROM products
        WHERE id = ANY($1::int[])
        `,
        [productIds]
    );

    const productMap = {};

    productsResult.rows.forEach(function (product) {
        productMap[product.id] = product;
    });

    let totalAmount = 0;
    const trustedItems = [];

    for (const item of items) {

        const product = productMap[item.id];

        if (!product) {

            throw new Error(
                "One of the items in your cart is no longer available."
            );

        }

        const quantity =
            Math.max(
                1,
                parseInt(item.quantity) || 1
            );

        const unitPrice =
            getEffectivePrice(product);

        const lineTotal =
            unitPrice * quantity;

        totalAmount += lineTotal;

        trustedItems.push({
            id: product.id,
            name: product.name,
            price: unitPrice,
            quantity: quantity
        });

    }

    return {
        totalAmount,
        trustedItems
    };

}


/*
    Asks Monnify for the real status of a
    payment and updates our own orders table
    to match. Used by both the manual "verify
    after checkout" call and the webhook.
*/

async function applyOrderPaymentResult(order, isPaid, isFailed, transactionReference, statusLabel) {

    const wasAlreadyPaid =
        order.status === "paid";

    const updatedResult = await pool.query(
        `
        UPDATE orders
        SET
            status = $1,
            transaction_reference = $2,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
        `,
        [
            isPaid ? "paid" : (isFailed ? "failed" : "pending"),
            transactionReference,
            order.id
        ]
    );


    // ====================================
    // CREDIT SELLERS' WALLETS
    // (only on the first confirmation of
    // this order, never twice)
    // ====================================

    if (isPaid && !wasAlreadyPaid) {

        try {

            await creditSellersForOrder(
                updatedResult.rows[0]
            );

        } catch (error) {

            console.error(
                "Wallet crediting error:",
                error.message
            );

        }

    }

    return {
        success: isPaid,
        message:
            isPaid ?
                "Payment confirmed." :
                "Payment status: " + statusLabel,
        order: updatedResult.rows[0]
    };

}


// ========================================
// CREDIT EACH SELLER'S WALLET FOR THEIR
// SHARE OF A NEWLY-PAID ORDER
// ========================================

async function creditSellersForOrder(order) {

    let items = [];

    try {

        items =
            typeof order.items === "string" ?
                JSON.parse(order.items) :
                order.items;

    } catch (error) {

        return;

    }

    if (!items || items.length === 0) {
        return;
    }

    const productIds =
        items.map(function (item) {
            return item.id;
        });

    const productsResult = await pool.query(
        `
        SELECT id, seller_id
        FROM products
        WHERE id = ANY($1::int[])
        AND seller_id IS NOT NULL
        `,
        [productIds]
    );

    const sellerIdByProductId = {};

    productsResult.rows.forEach(function (row) {
        sellerIdByProductId[row.id] = row.seller_id;
    });


    // Group this order's line items by seller.

    const subtotalsBySeller = {};

    items.forEach(function (item) {

        const sellerId =
            sellerIdByProductId[item.id];

        if (!sellerId) {
            return;
        }

        const lineTotal =
            Number(item.price) * Number(item.quantity);

        subtotalsBySeller[sellerId] =
            (subtotalsBySeller[sellerId] || 0) + lineTotal;

    });


    for (const sellerId of Object.keys(subtotalsBySeller)) {

        const amount =
            subtotalsBySeller[sellerId];

        await pool.query(
            `
            UPDATE sellers
            SET wallet_balance = wallet_balance + $1
            WHERE id = $2
            `,
            [amount, sellerId]
        );

        await pool.query(
            `
            INSERT INTO wallet_transactions (
                seller_id, type, amount, description, order_id
            )
            VALUES ($1, 'credit', $2, $3, $4)
            `,
            [
                sellerId,
                amount,
                "Sale from order #" + order.id,
                order.id
            ]
        );

    }

}


async function verifyAndUpdateOrder(paymentReference) {

    const orderResult = await pool.query(
        `
        SELECT *
        FROM orders
        WHERE payment_reference = $1
        LIMIT 1
        `,
        [paymentReference]
    );

    if (orderResult.rows.length === 0) {

        return {
            success: false,
            message: "Order not found.",
            order: null
        };

    }

    const order =
        orderResult.rows[0];


    // Already confirmed earlier — no need to ask again.

    if (order.status === "paid") {

        return {
            success: true,
            message: "Payment already confirmed.",
            order: order
        };

    }


    // ========================================
    // OPAY
    // ========================================

    if (order.payment_gateway === "opay") {

        let opayData;

        try {

            opayData =
                await queryOpayPaymentStatus(paymentReference);

        } catch (error) {

            return {
                success: false,
                message: "Could not verify this payment with OPay.",
                order: order
            };

        }

        const isPaid =
            opayData.status === "SUCCESS" &&
            Number(opayData.amount.total) >=
                Math.round(Number(order.amount) * 100);

        const isFailed =
            opayData.status === "FAIL" ||
            opayData.status === "CLOSE";

        return await applyOrderPaymentResult(
            order,
            isPaid,
            isFailed,
            opayData.orderNo,
            opayData.status
        );

    }


    // ========================================
    // PAYSTACK
    // ========================================

    if (order.payment_gateway === "paystack") {

        let paystackData;

        try {

            paystackData =
                await verifyPaystackTransaction(paymentReference);

        } catch (error) {

            return {
                success: false,
                message: "Could not verify this payment with Paystack.",
                order: order
            };

        }

        const isPaid =
            paystackData.status === "success" &&
            Number(paystackData.amount) >= Math.round(Number(order.amount) * 100);

        const isFailed =
            paystackData.status === "failed" ||
            paystackData.status === "abandoned";

        return await applyOrderPaymentResult(
            order,
            isPaid,
            isFailed,
            paystackData.id,
            paystackData.status
        );

    }


    // ========================================
    // MONNIFY (default)
    // ========================================

    const accessToken =
        await getMonnifyAccessToken();

    const verifyResponse = await fetch(
        MONNIFY_BASE_URL +
        "/api/v2/merchant/transactions/query?paymentReference=" +
        encodeURIComponent(paymentReference),
        {
            headers: {
                "Authorization": "Bearer " + accessToken
            },
            signal: AbortSignal.timeout(15000)
        }
    );

    const verifyData =
        await verifyResponse.json();

    if (!verifyData.requestSuccessful) {

        return {
            success: false,
            message: "Could not verify this payment with Monnify.",
            order: order
        };

    }


    const paymentStatus =
        verifyData.responseBody.paymentStatus;

    const amountPaid =
        Number(verifyData.responseBody.amountPaid || 0);

    const transactionReference =
        verifyData.responseBody.transactionReference;

    const isPaid =
        (paymentStatus === "PAID" || paymentStatus === "OVERPAID") &&
        amountPaid >= Number(order.amount);

    const isFailed =
        paymentStatus === "FAILED" ||
        paymentStatus === "EXPIRED" ||
        paymentStatus === "REVERSED";

    return await applyOrderPaymentResult(
        order,
        isPaid,
        isFailed,
        transactionReference,
        paymentStatus
    );

}


// ========================================
// START A CHECKOUT
// ========================================

app.post("/api/orders/initiate", async (req, res) => {

    try {

        const {
            studentId,
            items,
            customerName,
            customerEmail
        } = req.body;

        if (
            !studentId ||
            !Array.isArray(items) ||
            items.length === 0
        ) {

            return res.status(400).json({
                success: false,
                message: "Your cart is empty."
            });

        }


        let totalAmount;
        let trustedItems;

        try {

            const built =
                await buildTrustedOrderItems(items);

            totalAmount = built.totalAmount;
            trustedItems = built.trustedItems;

        } catch (buildError) {

            return res.status(400).json({
                success: false,
                message: buildError.message
            });

        }


        if (
            !totalAmount ||
            isNaN(totalAmount) ||
            totalAmount <= 0
        ) {

            return res.status(400).json({
                success: false,
                message: "Order total must be greater than zero. Please check the prices on items in your cart."
            });

        }


        const paymentReference =
            "kurios_" +
            Date.now() +
            "_" +
            crypto.randomInt(100000, 999999);

        await pool.query(
            `
            INSERT INTO orders (
                student_id,
                payment_reference,
                items,
                amount,
                status
            )
            VALUES ($1, $2, $3, $4, 'pending')
            `,
            [
                studentId,
                paymentReference,
                JSON.stringify(trustedItems),
                totalAmount
            ]
        );


        res.status(200).json({

            success: true,

            paymentReference: paymentReference,

            amount: totalAmount,

            customerName: customerName || "Kurios Student",

            customerEmail: customerEmail || ""

        });

    } catch (error) {

        console.error(
            "Order initiate error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while starting your order."
        });

    }

});


// ========================================
// GET MONNIFY CHECKOUT DETAILS FOR AN ORDER
// ========================================

app.post("/api/orders/pay/monnify", async (req, res) => {

    try {

        const { paymentReference } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const orderResult = await pool.query(
            `SELECT * FROM orders WHERE payment_reference = $1 LIMIT 1`,
            [paymentReference]
        );

        if (orderResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Order not found."
            });

        }

        const order = orderResult.rows[0];

        await pool.query(
            `UPDATE orders SET payment_gateway = 'monnify' WHERE id = $1`,
            [order.id]
        );

        res.status(200).json({

            success: true,

            paymentReference: paymentReference,

            amount: Number(order.amount),

            apiKey: MONNIFY_API_KEY,

            contractCode: MONNIFY_CONTRACT_CODE

        });

    } catch (error) {

        console.error(
            "Order Monnify checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not start Monnify checkout."
        });

    }

});


// ========================================
// GET OPAY CHECKOUT DETAILS FOR AN ORDER
// ========================================

app.post("/api/orders/pay/opay", async (req, res) => {

    try {

        const { paymentReference, returnUrl, customerName, customerEmail } = req.body;

        if (!paymentReference || !returnUrl) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference or return URL."
            });

        }

        const orderResult = await pool.query(
            `SELECT * FROM orders WHERE payment_reference = $1 LIMIT 1`,
            [paymentReference]
        );

        if (orderResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Order not found."
            });

        }

        const order = orderResult.rows[0];

        const opayData =
            await createOpayCashierPayment({
                reference: paymentReference,
                amountNaira: Number(order.amount),
                customerName: customerName || "Kurios Student",
                customerEmail: customerEmail || "",
                description: "Kurios Stores order",
                returnUrl: returnUrl,
                callbackUrl: OPAY_CALLBACK_URL
            });

        await pool.query(
            `UPDATE orders SET payment_gateway = 'opay' WHERE id = $1`,
            [order.id]
        );

        res.status(200).json({

            success: true,

            cashierUrl: opayData.cashierUrl

        });

    } catch (error) {

        console.error(
            "Order OPay checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message || "Could not start OPay checkout."
        });

    }

});


// ========================================
// GET PAYSTACK CHECKOUT DETAILS FOR AN ORDER
// ========================================

app.post("/api/orders/pay/paystack", async (req, res) => {

    try {

        const { paymentReference, returnUrl, customerEmail } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const orderResult = await pool.query(
            `SELECT * FROM orders WHERE payment_reference = $1 LIMIT 1`,
            [paymentReference]
        );

        if (orderResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Order not found."
            });

        }

        const order = orderResult.rows[0];

        const paystackData =
            await initializePaystackTransaction({
                reference: paymentReference,
                amountNaira: Number(order.amount),
                email: customerEmail,
                callbackUrl: returnUrl
            });

        await pool.query(
            `UPDATE orders SET payment_gateway = 'paystack' WHERE id = $1`,
            [order.id]
        );

        res.status(200).json({

            success: true,

            authorizationUrl: paystackData.authorization_url

        });

    } catch (error) {

        console.error(
            "Order Paystack checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message || "Could not start Paystack checkout."
        });

    }

});


// ========================================
// VERIFY A CHECKOUT (called right after
// the Monnify widget closes)
// ========================================

app.post("/api/orders/verify", async (req, res) => {

    try {

        const { paymentReference } =
            req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const result =
            await verifyAndUpdateOrder(
                paymentReference
            );

        if (!result.order) {

            return res.status(404).json(result);

        }

        res.status(200).json(result);

    } catch (error) {

        console.error(
            "Order verify error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while verifying your payment."
        });

    }

});


// ========================================
// ROUTE A WEBHOOK PAYMENT REFERENCE TO THE
// RIGHT VERIFIER (order / seller fee / wallet
// top-up) — shared by all three gateways
// ========================================

async function routeWebhookVerification(paymentReference) {

    if (paymentReference.startsWith("kurios_seller_")) {

        return await verifyAndUpdateSellerPayment(paymentReference);

    }

    if (paymentReference.startsWith("kurios_topup_")) {

        return await verifyAndUpdateWalletTopup(paymentReference);

    }

    if (paymentReference.startsWith("kurios_errandagent_")) {

        return await verifyAndUpdateErrandAgentPayment(paymentReference);

    }

    if (paymentReference.startsWith("kurios_craftreq_")) {

        return await verifyAndUpdateCraftRequestPayment(paymentReference);

    }

    if (paymentReference.startsWith("kurios_craft_")) {

        return await verifyAndUpdateCraftProviderPayment(paymentReference);

    }

    if (paymentReference.startsWith("kurios_errand_item_")) {

        return await verifyAndUpdateErrandItemCostPayment(paymentReference);

    }

    if (paymentReference.startsWith("kurios_errand_")) {

        return await verifyAndUpdateErrandPayment(paymentReference);

    }

    return await verifyAndUpdateOrder(paymentReference);

}


// ========================================
// MONNIFY WEBHOOK
// (catches payments even if the student
// closes the browser before we can verify)
// ========================================

app.post("/api/orders/webhook", async (req, res) => {

    try {

        const paymentReference =
            req.body &&
            req.body.eventData &&
            req.body.eventData.paymentReference;

        if (!paymentReference) {

            // Nothing we recognise — acknowledge
            // anyway so Monnify doesn't keep retrying.

            return res.status(200).send("ignored");

        }

        await routeWebhookVerification(paymentReference);

        res.status(200).send("ok");

    } catch (error) {

        console.error(
            "Monnify webhook error:",
            error.message
        );

        // Still 200 — Monnify will retry on non-2xx,
        // and we don't want a retry storm over a bug
        // on our side. We'll catch it on next verify.

        res.status(200).send("error logged");

    }

});


// ========================================
// OPAY WEBHOOK
// (catches payments even if the student
// closes the browser before we can verify —
// we never trust the callback body's stated
// status, we just use it to find the reference
// and then re-check with OPay directly)
// ========================================

app.post("/api/opay/webhook", async (req, res) => {

    try {

        const paymentReference =
            req.body &&
            req.body.payload &&
            req.body.payload.reference;

        if (!paymentReference) {

            return res.status(200).send("ignored");

        }

        await routeWebhookVerification(paymentReference);

        res.status(200).send("ok");

    } catch (error) {

        console.error(
            "OPay webhook error:",
            error.message
        );

        res.status(200).send("error logged");

    }

});


// ========================================
// PAYSTACK WEBHOOK
// (catches payments even if the student
// closes the browser before we can verify)
// ========================================

app.post("/api/paystack/webhook", async (req, res) => {

    try {

        const paymentReference =
            req.body &&
            req.body.data &&
            req.body.data.reference;

        if (!paymentReference) {

            return res.status(200).send("ignored");

        }

        await routeWebhookVerification(paymentReference);

        res.status(200).send("ok");

    } catch (error) {

        console.error(
            "Paystack webhook error:",
            error.message
        );

        res.status(200).send("error logged");

    }

});


// ========================================
// PAYSTACK CALLBACK
// (the browser lands here after checkout —
// just bounces to the frontend, which then
// calls /api/orders/verify or the seller
// equivalent using the reference in the URL)
// ========================================

app.get("/api/paystack/callback", async (req, res) => {

    const reference =
        req.query.reference || req.query.trxref || "";

    const isSellerPayment =
        reference.startsWith("kurios_seller_");

    const frontendUrl =
        (process.env.FRONTEND_URL || "https://kuriosstores.com") +
        (isSellerPayment ? "/#sell" : "/") +
        "?paystack_reference=" + encodeURIComponent(reference);

    res.redirect(frontendUrl);

});


// ========================================
// LIST A STUDENT'S ORDERS
// ========================================

app.get("/api/orders", async (req, res) => {

    try {

        const { studentId } =
            req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `
            SELECT
                id,
                payment_reference,
                transaction_reference,
                payment_gateway,
                items,
                amount,
                status,
                created_at
            FROM orders
            WHERE student_id = $1
            ORDER BY created_at DESC
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            orders: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch orders error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your orders."
        });

    }

});


// ========================================
// DELETE AN ORDER
// (only failed orders — never paid ones)
// ========================================

app.delete("/api/orders/:id", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const orderResult = await pool.query(
            `SELECT * FROM orders WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (orderResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Order not found."
            });

        }

        const order = orderResult.rows[0];

        if (String(order.student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your order."
            });

        }

        if (order.status !== "failed") {

            return res.status(400).json({
                success: false,
                message: "Only failed orders can be deleted."
            });

        }

        await pool.query(
            `DELETE FROM orders WHERE id = $1`,
            [id]
        );

        res.status(200).json({
            success: true,
            message: "Order deleted."
        });

    } catch (error) {

        console.error(
            "Delete order error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not delete this order."
        });

    }

});


// ========================================
// EDIT A PENDING ORDER
// (change item quantities, or remove
// items — only while still pending)
// ========================================

app.patch("/api/orders/:id", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId, items } = req.body;

        if (!studentId || !Array.isArray(items) || items.length === 0) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId or items."
            });

        }

        const orderResult = await pool.query(
            `SELECT * FROM orders WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (orderResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Order not found."
            });

        }

        const order = orderResult.rows[0];

        if (String(order.student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your order."
            });

        }

        if (order.status !== "pending") {

            return res.status(400).json({
                success: false,
                message: "Only pending orders can be edited."
            });

        }

        let totalAmount;
        let trustedItems;

        try {

            const built =
                await buildTrustedOrderItems(items);

            totalAmount = built.totalAmount;
            trustedItems = built.trustedItems;

        } catch (buildError) {

            return res.status(400).json({
                success: false,
                message: buildError.message
            });

        }

        if (!totalAmount || isNaN(totalAmount) || totalAmount <= 0) {

            return res.status(400).json({
                success: false,
                message: "Order total must be greater than zero."
            });

        }

        const updateResult = await pool.query(
            `
            UPDATE orders
            SET items = $1, amount = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
            `,
            [JSON.stringify(trustedItems), totalAmount, id]
        );

        res.status(200).json({
            success: true,
            order: updateResult.rows[0]
        });

    } catch (error) {

        console.error(
            "Edit order error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not update this order."
        });

    }

});




// ========================================
// ADMIN LOGIN
// ========================================

app.post("/api/admin/login", async (req, res) => {

    try {

        const { username, password } = req.body;

        if (!username || !password) {

            return res.status(400).json({
                success: false,
                message: "Username and password are required."
            });

        }

        const adminResult = await pool.query(
            `
            SELECT id, name, username, password_hash
            FROM admins
            WHERE LOWER(username) = LOWER($1)
            LIMIT 1
            `,
            [username.trim()]
        );

        if (adminResult.rows.length === 0) {

            return res.status(401).json({
                success: false,
                message: "Invalid username or password."
            });

        }

        const admin = adminResult.rows[0];

        const passwordMatches =
            await bcrypt.compare(password, admin.password_hash);

        if (!passwordMatches) {

            return res.status(401).json({
                success: false,
                message: "Invalid username or password."
            });

        }


        // ====================================
        // CREATE A SESSION TOKEN
        // (valid for 7 days)
        // ====================================

        const token =
            crypto.randomBytes(32).toString("hex");

        const expiresAt =
            new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

        await pool.query(
            `
            INSERT INTO admin_sessions (admin_id, token, expires_at)
            VALUES ($1, $2, $3)
            `,
            [admin.id, token, expiresAt]
        );

        res.status(200).json({

            success: true,

            message: "Welcome back.",

            token: token,

            admin: {
                id: admin.id,
                name: admin.name,
                username: admin.username
            }

        });

    } catch (error) {

        console.error(
            "Admin login error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while signing you in."
        });

    }

});


// ========================================
// ADMIN AUTH MIDDLEWARE
// (used for all other /api/admin/* routes)
// ========================================

/*
    Requests must include the session token
    returned by /api/admin/login as a header:

    Authorization: Bearer <token>
*/

async function requireAdminAuth(req, res, next) {

    try {

        const authHeader =
            req.header("authorization") || "";

        const token =
            authHeader.startsWith("Bearer ") ?
                authHeader.slice(7).trim() :
                null;

        if (!token) {

            return res.status(401).json({
                success: false,
                message: "Please sign in as an admin."
            });

        }

        const sessionResult = await pool.query(
            `
            SELECT admin_sessions.admin_id, admins.name, admins.username
            FROM admin_sessions
            JOIN admins ON admins.id = admin_sessions.admin_id
            WHERE admin_sessions.token = $1
            AND admin_sessions.expires_at > NOW()
            LIMIT 1
            `,
            [token]
        );

        if (sessionResult.rows.length === 0) {

            return res.status(401).json({
                success: false,
                message: "Your admin session has expired. Please sign in again."
            });

        }

        req.admin = sessionResult.rows[0];

        next();

    } catch (error) {

        console.error(
            "Admin auth check error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not verify admin session."
        });

    }

}


const VALID_SELLER_TYPES = [
    "student_seller",
    "vendor",
    "restaurant",
    "service_provider"
];


// ========================================
// APPLY TO BECOME A SELLER
// ========================================

app.post("/api/sellers/apply", async (req, res) => {

    try {

        const {
            studentId,
            sellerType,
            storeName,
            storeDescription,
            businessCategory,
            location,
            contactPhone,
            contactWhatsapp
        } = req.body;

        if (!studentId || !storeName) {

            return res.status(400).json({
                success: false,
                message: "Please provide at least a store name."
            });

        }

        const resolvedSellerType =
            VALID_SELLER_TYPES.includes(sellerType) ?
                sellerType :
                "student_seller";


        // ====================================
        // CONFIRM STUDENT EXISTS
        // ====================================

        const studentCheck = await pool.query(
            `
            SELECT id, first_name, last_name, email
            FROM students
            WHERE id = $1
            LIMIT 1
            `,
            [studentId]
        );

        if (studentCheck.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student account could not be found."
            });

        }

        const student = studentCheck.rows[0];


        // ====================================
        // BLOCK DUPLICATE ACTIVE APPLICATIONS
        // ====================================

        const existingCheck = await pool.query(
            `
            SELECT *
            FROM sellers
            WHERE student_id = $1
            AND status IN ('pending', 'approved', 'pending_payment')
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [studentId]
        );

        if (existingCheck.rows.length > 0) {

            const existing = existingCheck.rows[0];

            if (existing.status !== "pending_payment") {

                return res.status(409).json({
                    success: false,
                    message:
                        existing.status === "approved" ?
                            "You're already an approved seller." :
                            "You already have a pending seller application.",
                    status: existing.status
                });

            }

            // An unpaid application already exists — resume
            // it with the same payment reference instead of
            // creating a duplicate row.

            return res.status(200).json({

                success: true,

                message: "Continue to payment to submit your application.",

                seller: existing,

                paymentReference: existing.payment_reference,

                amount: Number(existing.application_fee),

                customerName:
                    `${student.first_name || ""} ${student.last_name || ""}`.trim(),

                customerEmail: student.email

            });

        }


        // ====================================
        // SAVE APPLICATION (AWAITING PAYMENT)
        // ====================================

        const applicationFee = 1500;

        const paymentReference =
            "kurios_seller_" +
            Date.now() +
            "_" +
            crypto.randomInt(100000, 999999);

        const result = await pool.query(
            `
            INSERT INTO sellers (
                student_id,
                seller_type,
                store_name,
                store_description,
                business_category,
                location,
                contact_phone,
                contact_whatsapp,
                status,
                application_fee,
                payment_reference,
                payment_status
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending_payment', $9, $10, 'unpaid')
            RETURNING *
            `,
            [
                studentId,
                resolvedSellerType,
                storeName.trim(),
                storeDescription ? storeDescription.trim() : null,
                businessCategory ? businessCategory.trim() : null,
                location ? location.trim() : null,
                contactPhone ? contactPhone.trim() : null,
                contactWhatsapp ? contactWhatsapp.trim() : null,
                applicationFee,
                paymentReference
            ]
        );

        res.status(201).json({

            success: true,

            message:
                "Choose a payment method to submit your application.",

            seller: result.rows[0],

            paymentReference: paymentReference,

            amount: applicationFee,

            customerName:
                `${student.first_name || ""} ${student.last_name || ""}`.trim(),

            customerEmail: student.email

        });

    } catch (error) {

        console.error(
            "Seller application error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while submitting your application."
        });

    }

});


// ========================================
// GET MONNIFY CHECKOUT DETAILS FOR A
// SELLER APPLICATION FEE
// ========================================

app.post("/api/sellers/apply/pay/monnify", async (req, res) => {

    try {

        const { paymentReference } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const sellerResult = await pool.query(
            `
            SELECT sellers.*, students.first_name, students.last_name, students.email
            FROM sellers
            LEFT JOIN students ON students.id = sellers.student_id
            WHERE sellers.payment_reference = $1
            LIMIT 1
            `,
            [paymentReference]
        );

        if (sellerResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Seller application not found."
            });

        }

        const seller = sellerResult.rows[0];

        await pool.query(
            `UPDATE sellers SET payment_gateway = 'monnify' WHERE id = $1`,
            [seller.id]
        );

        res.status(200).json({

            success: true,

            paymentReference: paymentReference,

            amount: Number(seller.application_fee),

            apiKey: MONNIFY_API_KEY,

            contractCode: MONNIFY_CONTRACT_CODE,

            customerName:
                `${seller.first_name || ""} ${seller.last_name || ""}`.trim(),

            customerEmail: seller.email

        });

    } catch (error) {

        console.error(
            "Seller Monnify checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not start Monnify checkout."
        });

    }

});


// ========================================
// GET OPAY CHECKOUT DETAILS FOR A
// SELLER APPLICATION FEE
// ========================================

app.post("/api/sellers/apply/pay/opay", async (req, res) => {

    try {

        const { paymentReference, returnUrl } = req.body;

        if (!paymentReference || !returnUrl) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference or return URL."
            });

        }

        const sellerResult = await pool.query(
            `
            SELECT sellers.*, students.first_name, students.last_name, students.email
            FROM sellers
            LEFT JOIN students ON students.id = sellers.student_id
            WHERE sellers.payment_reference = $1
            LIMIT 1
            `,
            [paymentReference]
        );

        if (sellerResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Seller application not found."
            });

        }

        const seller = sellerResult.rows[0];

        const opayData =
            await createOpayCashierPayment({
                reference: paymentReference,
                amountNaira: Number(seller.application_fee),
                customerName:
                    `${seller.first_name || ""} ${seller.last_name || ""}`.trim(),
                customerEmail: seller.email,
                description: "Kurios Stores seller application fee",
                returnUrl: returnUrl,
                callbackUrl: OPAY_CALLBACK_URL
            });

        await pool.query(
            `UPDATE sellers SET payment_gateway = 'opay' WHERE id = $1`,
            [seller.id]
        );

        res.status(200).json({

            success: true,

            cashierUrl: opayData.cashierUrl

        });

    } catch (error) {

        console.error(
            "Seller OPay checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message || "Could not start OPay checkout."
        });

    }

});


// ========================================
// GET PAYSTACK CHECKOUT DETAILS FOR A
// SELLER APPLICATION FEE
// ========================================

app.post("/api/sellers/apply/pay/paystack", async (req, res) => {

    try {

        const { paymentReference, returnUrl } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const sellerResult = await pool.query(
            `
            SELECT sellers.*, students.email
            FROM sellers
            LEFT JOIN students ON students.id = sellers.student_id
            WHERE sellers.payment_reference = $1
            LIMIT 1
            `,
            [paymentReference]
        );

        if (sellerResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Seller application not found."
            });

        }

        const seller = sellerResult.rows[0];

        const paystackData =
            await initializePaystackTransaction({
                reference: paymentReference,
                amountNaira: Number(seller.application_fee),
                email: seller.email,
                callbackUrl: returnUrl
            });

        await pool.query(
            `UPDATE sellers SET payment_gateway = 'paystack' WHERE id = $1`,
            [seller.id]
        );

        res.status(200).json({

            success: true,

            authorizationUrl: paystackData.authorization_url

        });

    } catch (error) {

        console.error(
            "Seller Paystack checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message || "Could not start Paystack checkout."
        });

    }

});


// ========================================
// VERIFY A SELLER APPLICATION FEE PAYMENT
// ========================================

async function applySellerPaymentResult(seller, isPaid, isFailed, transactionReference, statusLabel) {

    const updatedResult = await pool.query(
        `
        UPDATE sellers
        SET
            payment_status = $1,
            status = $2,
            transaction_reference = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $4
        RETURNING *
        `,
        [
            isPaid ? "paid" : (isFailed ? "failed" : "unpaid"),
            isPaid ? "pending" : "pending_payment",
            transactionReference,
            seller.id
        ]
    );

    return {
        success: isPaid,
        message:
            isPaid ?
                "Payment confirmed. Your application is now under review." :
                "Payment status: " + statusLabel,
        seller: updatedResult.rows[0]
    };

}


async function verifyAndUpdateSellerPayment(paymentReference) {

    const sellerResult = await pool.query(
        `
        SELECT *
        FROM sellers
        WHERE payment_reference = $1
        LIMIT 1
        `,
        [paymentReference]
    );

    if (sellerResult.rows.length === 0) {

        return {
            success: false,
            message: "Seller application not found.",
            seller: null
        };

    }

    const seller =
        sellerResult.rows[0];

    if (seller.payment_status === "paid") {

        return {
            success: true,
            message: "Payment already confirmed.",
            seller: seller
        };

    }


    // ========================================
    // OPAY
    // ========================================

    if (seller.payment_gateway === "opay") {

        let opayData;

        try {

            opayData =
                await queryOpayPaymentStatus(paymentReference);

        } catch (error) {

            return {
                success: false,
                message: "Could not verify this payment with OPay.",
                seller: seller
            };

        }

        const isPaid =
            opayData.status === "SUCCESS" &&
            Number(opayData.amount.total) >=
                Math.round(Number(seller.application_fee) * 100);

        const isFailed =
            opayData.status === "FAIL" ||
            opayData.status === "CLOSE";

        return await applySellerPaymentResult(
            seller,
            isPaid,
            isFailed,
            opayData.orderNo,
            opayData.status
        );

    }


    // ========================================
    // PAYSTACK
    // ========================================

    if (seller.payment_gateway === "paystack") {

        let paystackData;

        try {

            paystackData =
                await verifyPaystackTransaction(paymentReference);

        } catch (error) {

            return {
                success: false,
                message: "Could not verify this payment with Paystack.",
                seller: seller
            };

        }

        const isPaid =
            paystackData.status === "success" &&
            Number(paystackData.amount) >= Math.round(Number(seller.application_fee) * 100);

        const isFailed =
            paystackData.status === "failed" ||
            paystackData.status === "abandoned";

        return await applySellerPaymentResult(
            seller,
            isPaid,
            isFailed,
            paystackData.id,
            paystackData.status
        );

    }


    // ========================================
    // MONNIFY (default)
    // ========================================

    const accessToken =
        await getMonnifyAccessToken();

    const verifyResponse = await fetch(
        MONNIFY_BASE_URL +
        "/api/v2/merchant/transactions/query?paymentReference=" +
        encodeURIComponent(paymentReference),
        {
            headers: {
                "Authorization": "Bearer " + accessToken
            },
            signal: AbortSignal.timeout(15000)
        }
    );

    const verifyData =
        await verifyResponse.json();

    if (!verifyData.requestSuccessful) {

        return {
            success: false,
            message: "Could not verify this payment with Monnify.",
            seller: seller
        };

    }

    const paymentStatus =
        verifyData.responseBody.paymentStatus;

    const amountPaid =
        Number(verifyData.responseBody.amountPaid || 0);

    const transactionReference =
        verifyData.responseBody.transactionReference;

    const isPaid =
        (paymentStatus === "PAID" || paymentStatus === "OVERPAID") &&
        amountPaid >= Number(seller.application_fee);

    const isFailed =
        paymentStatus === "FAILED" ||
        paymentStatus === "EXPIRED" ||
        paymentStatus === "REVERSED";

    return await applySellerPaymentResult(
        seller,
        isPaid,
        isFailed,
        transactionReference,
        paymentStatus
    );

}


app.post("/api/sellers/apply/verify-payment", async (req, res) => {

    try {

        const { paymentReference } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const result =
            await verifyAndUpdateSellerPayment(paymentReference);

        if (!result.seller) {

            return res.status(404).json(result);

        }

        res.status(200).json(result);

    } catch (error) {

        console.error(
            "Seller payment verify error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while verifying your payment."
        });

    }

});


// ========================================
// GET MY SELLER STATUS
// ========================================

app.get("/api/sellers/me", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `
            SELECT *
            FROM sellers
            WHERE student_id = $1
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            seller: result.rows[0] || null
        });

    } catch (error) {

        console.error(
            "Fetch seller status error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not check your seller status."
        });

    }

});


// ========================================
// ADMIN — LIST SELLERS
// ========================================

app.get(
    "/api/admin/sellers",
    requireAdminAuth,
    async (req, res) => {

        try {

            const { status } = req.query;

            const validStatuses =
                ["pending", "approved", "rejected", "suspended"];

            let query =
                `
                SELECT
                    sellers.*,
                    students.first_name,
                    students.last_name,
                    students.email AS student_email,
                    students.university
                FROM sellers
                LEFT JOIN students ON students.id = sellers.student_id
                `;

            const params = [];

            if (status && validStatuses.includes(status)) {

                query += ` WHERE sellers.status = $1`;
                params.push(status);

            }

            query += ` ORDER BY sellers.created_at DESC`;

            const result =
                await pool.query(query, params);

            res.status(200).json({
                success: true,
                sellers: result.rows
            });

        } catch (error) {

            console.error(
                "Admin list sellers error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Could not load sellers."
            });

        }

    }
);


// ========================================
// ADMIN — APPROVE / REJECT / SUSPEND A SELLER
// ========================================

async function updateSellerStatus(req, res, newStatus) {

    try {

        const { id } = req.params;
        const { reason } = req.body;

        const result = await pool.query(
            `
            UPDATE sellers
            SET
                status = $1,
                rejection_reason = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
            RETURNING *
            `,
            [
                newStatus,
                newStatus === "rejected" ? (reason || null) : null,
                id
            ]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Seller application could not be found."
            });

        }

        res.status(200).json({
            success: true,
            message: "Seller status updated to " + newStatus + ".",
            seller: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Update seller status error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not update seller status."
        });

    }

}

app.post(
    "/api/admin/sellers/:id/approve",
    requireAdminAuth,
    (req, res) => updateSellerStatus(req, res, "approved")
);

app.post(
    "/api/admin/sellers/:id/reject",
    requireAdminAuth,
    (req, res) => updateSellerStatus(req, res, "rejected")
);

app.post(
    "/api/admin/sellers/:id/suspend",
    requireAdminAuth,
    (req, res) => updateSellerStatus(req, res, "suspended")
);


// ========================================
// GET LATEST NOTIFICATIONS
// (public — used by the student notification bell)
// ========================================

app.get("/api/notifications", async (req, res) => {

    try {

        const result = await pool.query(
            `
            SELECT id, title, message, created_at
            FROM notifications
            ORDER BY created_at DESC
            LIMIT 20
            `
        );

        res.status(200).json({
            success: true,
            notifications: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch notifications error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load notifications."
        });

    }

});


// ========================================
// ADMIN — SEND AN ANNOUNCEMENT TO ALL STUDENTS
// ========================================

app.post(
    "/api/admin/notifications",
    requireAdminAuth,
    async (req, res) => {

        try {

            const { title, message } = req.body;

            if (!title || !message) {

                return res.status(400).json({
                    success: false,
                    message: "Please provide a title and a message."
                });

            }

            const result = await pool.query(
                `
                INSERT INTO notifications (title, message, created_by)
                VALUES ($1, $2, $3)
                RETURNING *
                `,
                [
                    title.trim(),
                    message.trim(),
                    req.admin.admin_id
                ]
            );

            res.status(201).json({

                success: true,

                message: "Announcement sent to all students.",

                notification: result.rows[0]

            });

        } catch (error) {

            console.error(
                "Send notification error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Could not send the announcement."
            });

        }

    }
);


// ========================================
// ADMIN — LIST / SEARCH STUDENTS
// ========================================

app.get(
    "/api/admin/students",
    requireAdminAuth,
    async (req, res) => {

        try {

            const { search } = req.query;

            let query =
                `
                SELECT
                    id,
                    first_name,
                    last_name,
                    email,
                    phone,
                    whatsapp_number,
                    university,
                    student_id,
                    email_verified,
                    is_suspended,
                    is_support,
                    created_at
                FROM students
                `;

            const params = [];

            if (search && search.trim()) {

                query +=
                    `
                    WHERE
                        first_name ILIKE $1
                        OR last_name ILIKE $1
                        OR email ILIKE $1
                        OR university ILIKE $1
                        OR student_id ILIKE $1
                        OR phone ILIKE $1
                    `;

                params.push("%" + search.trim() + "%");

            }

            query += ` ORDER BY created_at DESC LIMIT 200`;

            const result =
                await pool.query(query, params);

            res.status(200).json({
                success: true,
                students: result.rows
            });

        } catch (error) {

            console.error(
                "Admin list students error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Could not load students."
            });

        }

    }
);


// ========================================
// ADMIN — SUSPEND / UNSUSPEND A STUDENT
// ========================================

async function setStudentSuspension(req, res, suspended) {

    try {

        const { id } = req.params;

        const result = await pool.query(
            `
            UPDATE students
            SET is_suspended = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, first_name, last_name, email, is_suspended
            `,
            [suspended, id]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student account could not be found."
            });

        }

        res.status(200).json({

            success: true,

            message:
                suspended ?
                    "Student account suspended." :
                    "Student account reinstated.",

            student: result.rows[0]

        });

    } catch (error) {

        console.error(
            "Update student suspension error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not update this student's account."
        });

    }

}

async function setStudentSupportStatus(req, res, isSupport) {

    try {

        const { id } = req.params;

        const result = await pool.query(
            `
            UPDATE students
            SET is_support = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING id, first_name, last_name, email, is_support
            `,
            [isSupport, id]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student account could not be found."
            });

        }

        res.status(200).json({

            success: true,

            message:
                isSupport ?
                    "This account is now KSupport staff." :
                    "KSupport access removed from this account.",

            student: result.rows[0]

        });

    } catch (error) {

        console.error(
            "Update student support status error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not update this student's account."
        });

    }

}

app.post(
    "/api/admin/students/:id/suspend",
    requireAdminAuth,
    (req, res) => setStudentSuspension(req, res, true)
);

app.post(
    "/api/admin/students/:id/unsuspend",
    requireAdminAuth,
    (req, res) => setStudentSuspension(req, res, false)
);

app.post(
    "/api/admin/students/:id/make-support",
    requireAdminAuth,
    (req, res) => setStudentSupportStatus(req, res, true)
);

app.post(
    "/api/admin/students/:id/remove-support",
    requireAdminAuth,
    (req, res) => setStudentSupportStatus(req, res, false)
);


// ========================================
// ADMIN — PAYOUT REQUESTS
// ========================================

app.get("/api/admin/payouts", requireAdminAuth, async (req, res) => {

    try {

        const { status } = req.query;

        const result = await pool.query(
            `
            SELECT
                payout_requests.*,
                sellers.store_name,
                students.first_name,
                students.last_name,
                students.email
            FROM payout_requests
            JOIN sellers ON sellers.id = payout_requests.seller_id
            JOIN students ON students.id = sellers.student_id
            ${status ? "WHERE payout_requests.status = $1" : ""}
            ORDER BY payout_requests.requested_at DESC
            `,
            status ? [status] : []
        );

        res.status(200).json({
            success: true,
            payouts: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch admin payouts error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load payout requests."
        });

    }

});

app.post("/api/admin/payouts/:id/approve", requireAdminAuth, async (req, res) => {

    try {

        const { id } = req.params;

        const result = await pool.query(
            `
            UPDATE payout_requests
            SET status = 'approved'
            WHERE id = $1 AND status = 'pending'
            RETURNING *
            `,
            [id]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Payout request not found or already processed."
            });

        }

        res.status(200).json({
            success: true,
            payout: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Approve payout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not approve this payout."
        });

    }

});

app.post("/api/admin/payouts/:id/mark-paid", requireAdminAuth, async (req, res) => {

    try {

        const { id } = req.params;
        const { payoutReference } = req.body;

        const result = await pool.query(
            `
            UPDATE payout_requests
            SET status = 'paid', payout_reference = $1, processed_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND status IN ('pending', 'approved')
            RETURNING *
            `,
            [payoutReference || null, id]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Payout request not found or already processed."
            });

        }

        const payout =
            result.rows[0];

        await pool.query(
            `
            INSERT INTO wallet_transactions (seller_id, type, amount, description)
            VALUES ($1, 'payout_paid', 0, 'Payout of ' || $2 || ' completed')
            `,
            [payout.seller_id, payout.amount]
        );

        res.status(200).json({
            success: true,
            payout: payout
        });

    } catch (error) {

        console.error(
            "Mark payout paid error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not mark this payout as paid."
        });

    }

});

app.post("/api/admin/payouts/:id/reject", requireAdminAuth, async (req, res) => {

    try {

        const { id } = req.params;
        const { adminNote } = req.body;

        const payoutResult = await pool.query(
            `SELECT * FROM payout_requests WHERE id = $1 AND status IN ('pending', 'approved') LIMIT 1`,
            [id]
        );

        if (payoutResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Payout request not found or already processed."
            });

        }

        const payout =
            payoutResult.rows[0];

        // Refund the escrowed amount back to the seller's
        // wallet — this is exactly why the balance was
        // deducted at request time, not at approval time.

        await pool.query(
            `UPDATE sellers SET wallet_balance = wallet_balance + $1 WHERE id = $2`,
            [Number(payout.amount), payout.seller_id]
        );

        await pool.query(
            `
            UPDATE payout_requests
            SET status = 'rejected', admin_note = $1, processed_at = CURRENT_TIMESTAMP
            WHERE id = $2
            `,
            [adminNote || null, id]
        );

        await pool.query(
            `
            INSERT INTO wallet_transactions (seller_id, type, amount, description)
            VALUES ($1, 'payout_rejected', $2, 'Payout request rejected — refunded')
            `,
            [payout.seller_id, Number(payout.amount)]
        );

        res.status(200).json({
            success: true,
            message: "Payout rejected and refunded to seller's wallet."
        });

    } catch (error) {

        console.error(
            "Reject payout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not reject this payout."
        });

    }

});


// ========================================
// SELLER PRODUCTS
// ========================================

async function getApprovedSeller(studentId) {

    const result = await pool.query(
        `
        SELECT *
        FROM sellers
        WHERE student_id = $1
        AND status = 'approved'
        LIMIT 1
        `,
        [studentId]
    );

    return result.rows[0] || null;

}


// ========================================
// SELLER SALES — ORDERS CONTAINING
// THIS SELLER'S PRODUCTS
// ========================================

/*
    Orders can mix products from several sellers
    in one checkout, and the order's stored items
    don't record who sold each one — so instead of
    tagging that at order time, we cross-reference
    the seller's current product IDs against each
    paid order's item list here, and only return
    the seller's own line items (plus their share
    of that order's total).
*/

app.get("/api/sellers/orders", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const seller =
            await getApprovedSeller(studentId);

        if (!seller) {

            return res.status(403).json({
                success: false,
                message: "Only approved sellers can view their sales."
            });

        }

        const productsResult = await pool.query(
            `SELECT id FROM products WHERE seller_id = $1`,
            [seller.id]
        );

        const sellerProductIds =
            new Set(
                productsResult.rows.map(function (row) {
                    return row.id;
                })
            );

        if (sellerProductIds.size === 0) {

            return res.status(200).json({
                success: true,
                orders: [],
                totalRevenue: 0
            });

        }

        const ordersResult = await pool.query(
            `
            SELECT
                orders.id,
                orders.payment_reference,
                orders.items,
                orders.created_at,
                students.first_name,
                students.last_name,
                students.email AS buyer_email,
                students.phone AS buyer_phone
            FROM orders
            JOIN students ON students.id = orders.student_id
            WHERE orders.status = 'paid'
            ORDER BY orders.created_at DESC
            LIMIT 300
            `
        );

        const sellerOrders = [];
        let totalRevenue = 0;

        ordersResult.rows.forEach(function (order) {

            let items = [];

            try {

                items =
                    typeof order.items === "string" ?
                        JSON.parse(order.items) :
                        order.items;

            } catch (error) {

                items = [];

            }

            const myItems =
                items.filter(function (item) {
                    return sellerProductIds.has(item.id);
                });

            if (myItems.length === 0) {
                return;
            }

            const mySubtotal =
                myItems.reduce(function (sum, item) {
                    return sum + (Number(item.price) * item.quantity);
                }, 0);

            totalRevenue += mySubtotal;

            const buyerName =
                `${order.first_name || ""} ${order.last_name || ""}`.trim();

            sellerOrders.push({
                orderId: order.id,
                paymentReference: order.payment_reference,
                createdAt: order.created_at,
                buyerName: buyerName || "Kurios Student",
                buyerEmail: order.buyer_email,
                buyerPhone: order.buyer_phone,
                items: myItems,
                subtotal: mySubtotal
            });

        });

        res.status(200).json({
            success: true,
            orders: sellerOrders,
            totalRevenue: totalRevenue
        });

    } catch (error) {

        console.error(
            "Seller orders error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your sales."
        });

    }

});


// ========================================
// SELLER WALLET — BALANCE + TRANSACTIONS
// ========================================

// ========================================
// STUDENT'S OWN WALLET
// (personal balance — only increases via a
// real top-up, never from selling products)
// ========================================

app.get("/api/students/wallet", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const studentResult = await pool.query(
            `SELECT wallet_balance FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (studentResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student not found."
            });

        }

        const topupsResult = await pool.query(
            `
            SELECT *
            FROM wallet_topups
            WHERE student_id = $1
            ORDER BY created_at DESC
            LIMIT 50
            `,
            [studentId]
        );

        res.status(200).json({

            success: true,

            balance: Number(studentResult.rows[0].wallet_balance || 0),

            topups: topupsResult.rows

        });

    } catch (error) {

        console.error(
            "Fetch student wallet error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your wallet."
        });

    }

});


// ========================================
// START A WALLET TOP-UP
// ========================================

app.post("/api/wallet/topup/initiate", async (req, res) => {

    try {

        const { studentId, amount } = req.body;

        if (!studentId || !amount || isNaN(amount) || Number(amount) <= 0) {

            return res.status(400).json({
                success: false,
                message: "Please enter a valid amount to top up."
            });

        }

        const paymentReference =
            "kurios_topup_" +
            Date.now() +
            "_" +
            crypto.randomInt(100000, 999999);

        await pool.query(
            `
            INSERT INTO wallet_topups (student_id, payment_reference, amount, status)
            VALUES ($1, $2, $3, 'pending')
            `,
            [studentId, paymentReference, Number(amount)]
        );

        res.status(200).json({

            success: true,

            paymentReference: paymentReference,

            amount: Number(amount)

        });

    } catch (error) {

        console.error(
            "Wallet topup initiate error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not start your top-up."
        });

    }

});


// ========================================
// GET GATEWAY CHECKOUT DETAILS FOR A
// WALLET TOP-UP
// ========================================

app.post("/api/wallet/topup/pay/:gateway", async (req, res) => {

    try {

        const { gateway } = req.params;
        const { paymentReference, returnUrl, customerName, customerEmail } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const topupResult = await pool.query(
            `SELECT * FROM wallet_topups WHERE payment_reference = $1 LIMIT 1`,
            [paymentReference]
        );

        if (topupResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Top-up not found."
            });

        }

        const topup = topupResult.rows[0];

        await pool.query(
            `UPDATE wallet_topups SET payment_gateway = $1 WHERE id = $2`,
            [gateway, topup.id]
        );

        if (gateway === "monnify") {

            return res.status(200).json({
                success: true,
                paymentReference: paymentReference,
                amount: Number(topup.amount),
                apiKey: MONNIFY_API_KEY,
                contractCode: MONNIFY_CONTRACT_CODE
            });

        }

        if (gateway === "opay") {

            const opayData =
                await createOpayCashierPayment({
                    reference: paymentReference,
                    amountNaira: Number(topup.amount),
                    customerName: customerName || "Kurios Student",
                    customerEmail: customerEmail || "",
                    description: "Kurios Stores wallet top-up",
                    returnUrl: returnUrl,
                    callbackUrl: OPAY_CALLBACK_URL
                });

            return res.status(200).json({
                success: true,
                cashierUrl: opayData.cashierUrl
            });

        }

        if (gateway === "paystack") {

            const paystackData =
                await initializePaystackTransaction({
                    reference: paymentReference,
                    amountNaira: Number(topup.amount),
                    email: customerEmail,
                    callbackUrl: returnUrl
                });

            return res.status(200).json({
                success: true,
                authorizationUrl: paystackData.authorization_url
            });

        }

        res.status(400).json({
            success: false,
            message: "Unknown payment gateway."
        });

    } catch (error) {

        console.error(
            "Wallet topup checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message || "Could not start checkout."
        });

    }

});


// ========================================
// VERIFY & CREDIT A WALLET TOP-UP
// (shared by the manual verify endpoint
// and all three gateway webhooks)
// ========================================

async function verifyAndUpdateWalletTopup(paymentReference) {

    const topupResult = await pool.query(
        `SELECT * FROM wallet_topups WHERE payment_reference = $1 LIMIT 1`,
        [paymentReference]
    );

    if (topupResult.rows.length === 0) {

        return {
            success: false,
            message: "Top-up not found.",
            topup: null
        };

    }

    const topup =
        topupResult.rows[0];

    if (topup.status === "paid") {

        return {
            success: true,
            message: "Top-up already confirmed.",
            topup: topup
        };

    }

    let isPaid = false;
    let isFailed = false;
    let transactionReference = null;

    try {

        if (topup.payment_gateway === "opay") {

            const opayData =
                await queryOpayPaymentStatus(paymentReference);

            isPaid =
                opayData.status === "SUCCESS" &&
                Number(opayData.amount.total) >= Math.round(Number(topup.amount) * 100);

            isFailed =
                opayData.status === "FAIL" || opayData.status === "CLOSE";

            transactionReference = opayData.orderNo;

        } else if (topup.payment_gateway === "paystack") {

            const paystackData =
                await verifyPaystackTransaction(paymentReference);

            isPaid =
                paystackData.status === "success" &&
                Number(paystackData.amount) >= Math.round(Number(topup.amount) * 100);

            isFailed =
                paystackData.status === "failed" || paystackData.status === "abandoned";

            transactionReference = paystackData.id;

        } else {

            const accessToken =
                await getMonnifyAccessToken();

            const verifyResponse = await fetch(
                MONNIFY_BASE_URL +
                "/api/v2/merchant/transactions/query?paymentReference=" +
                encodeURIComponent(paymentReference),
                {
                    headers: { "Authorization": "Bearer " + accessToken },
                    signal: AbortSignal.timeout(15000)
                }
            );

            const verifyData = await verifyResponse.json();

            if (verifyData.requestSuccessful) {

                const paymentStatus =
                    verifyData.responseBody.paymentStatus;

                const amountPaid =
                    Number(verifyData.responseBody.amountPaid || 0);

                isPaid =
                    (paymentStatus === "PAID" || paymentStatus === "OVERPAID") &&
                    amountPaid >= Number(topup.amount);

                isFailed =
                    paymentStatus === "FAILED" ||
                    paymentStatus === "EXPIRED" ||
                    paymentStatus === "REVERSED";

                transactionReference = verifyData.responseBody.transactionReference;

            }

        }

    } catch (error) {

        return {
            success: false,
            message: "Could not verify this payment.",
            topup: topup
        };

    }

    const updatedTopup = await pool.query(
        `
        UPDATE wallet_topups
        SET status = $1, transaction_reference = $2, updated_at = CURRENT_TIMESTAMP
        WHERE id = $3
        RETURNING *
        `,
        [isPaid ? "paid" : (isFailed ? "failed" : "pending"), transactionReference, topup.id]
    );

    // Credit the wallet — guarded so this can never
    // double-credit even if verify gets called twice.

    if (isPaid) {

        await pool.query(
            `
            UPDATE students
            SET wallet_balance = COALESCE(wallet_balance, 0) + $1
            WHERE id = $2
            `,
            [Number(topup.amount), topup.student_id]
        );

    }

    return {
        success: isPaid,
        message: isPaid ? "Top-up confirmed." : "Payment not yet confirmed.",
        topup: updatedTopup.rows[0]
    };

}

app.post("/api/wallet/topup/verify", async (req, res) => {

    try {

        const { paymentReference } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const result =
            await verifyAndUpdateWalletTopup(paymentReference);

        if (!result.topup) {
            return res.status(404).json(result);
        }

        res.status(200).json(result);

    } catch (error) {

        console.error(
            "Wallet topup verify error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while verifying your top-up."
        });

    }

});


// ========================================
// ERRANDS — CREATE A REQUEST
// ========================================

app.post("/api/errands/create", async (req, res) => {

    try {

        const { studentId, title, pickupLocation, destination, description, itemCost, errandFee } = req.body;

        if (!studentId || !title || !pickupLocation || !destination || !errandFee) {

            return res.status(400).json({
                success: false,
                message: "Please fill in the pickup, destination, and errand fee."
            });

        }

        if (Number(errandFee) < 100) {

            return res.status(400).json({
                success: false,
                message: "Errand fee must be at least ₦100."
            });

        }

        const itemCostEstimate =
            itemCost ? Number(itemCost) : 0;

        const errandFeeAmount =
            Number(errandFee);

        const commission =
            Math.round(errandFeeAmount * 0.20 * 100) / 100;

        const agentEarnings =
            errandFeeAmount - commission;

        // Only the errand fee is charged now — the item
        // cost (if any) isn't known precisely until the
        // agent is actually at the store, so it's collected
        // separately once they report the real figure.

        const totalAmount =
            errandFeeAmount;

        const paymentReference =
            "kurios_errand_" + Date.now() + "_" + crypto.randomInt(100000, 999999);

        const errandCode =
            "KRS-ERR-" + crypto.randomInt(10000, 99999);

        const result = await pool.query(
            `
            INSERT INTO errands (
                errand_code, student_id, title, pickup_location, destination, description,
                item_cost, errand_fee, total_amount, kurios_commission, agent_earnings,
                status, payment_reference
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'pending', $12)
            RETURNING *
            `,
            [
                errandCode, studentId, title.trim(), pickupLocation.trim(), destination.trim(),
                description ? description.trim() : null, itemCostEstimate, errandFeeAmount,
                totalAmount, commission, agentEarnings, paymentReference
            ]
        );

        res.status(201).json({
            success: true,
            errand: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Create errand error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not create your errand request."
        });

    }

});


// ========================================
// ERRANDS — CHECKOUT
// ========================================

app.post("/api/errands/pay/:gateway", async (req, res) => {

    try {

        const { gateway } = req.params;
        const { paymentReference, returnUrl, customerName, customerEmail } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const errandResult = await pool.query(
            `SELECT * FROM errands WHERE payment_reference = $1 LIMIT 1`,
            [paymentReference]
        );

        if (errandResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Errand not found."
            });

        }

        const errand =
            errandResult.rows[0];

        await pool.query(
            `UPDATE errands SET payment_gateway = $1 WHERE id = $2`,
            [gateway, errand.id]
        );

        if (gateway === "monnify") {

            return res.status(200).json({
                success: true,
                paymentReference: paymentReference,
                amount: Number(errand.total_amount),
                apiKey: MONNIFY_API_KEY,
                contractCode: MONNIFY_CONTRACT_CODE
            });

        }

        if (gateway === "opay") {

            const opayData =
                await createOpayCashierPayment({
                    reference: paymentReference,
                    amountNaira: Number(errand.total_amount),
                    customerName: customerName || "Kurios Student",
                    customerEmail: customerEmail || "",
                    description: "Kurios Stores errand — " + errand.title,
                    returnUrl: returnUrl,
                    callbackUrl: OPAY_CALLBACK_URL
                });

            return res.status(200).json({
                success: true,
                cashierUrl: opayData.cashierUrl
            });

        }

        if (gateway === "paystack") {

            const paystackData =
                await initializePaystackTransaction({
                    reference: paymentReference,
                    amountNaira: Number(errand.total_amount),
                    email: customerEmail,
                    callbackUrl: returnUrl
                });

            return res.status(200).json({
                success: true,
                authorizationUrl: paystackData.authorization_url
            });

        }

        res.status(400).json({
            success: false,
            message: "Unknown payment gateway."
        });

    } catch (error) {

        console.error(
            "Errand checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message || "Could not start checkout."
        });

    }

});


// ========================================
// ERRANDS — VERIFY PAYMENT
// (on success, the errand enters the
// available pool for eligible agents)
// ========================================

async function verifyAndUpdateErrandPayment(paymentReference) {

    const errandResult = await pool.query(
        `SELECT * FROM errands WHERE payment_reference = $1 LIMIT 1`,
        [paymentReference]
    );

    if (errandResult.rows.length === 0) {

        return {
            success: false,
            message: "Errand not found.",
            errand: null
        };

    }

    const errand =
        errandResult.rows[0];

    if (errand.status !== "pending") {

        return {
            success: errand.status !== "failed",
            message: "Payment already processed.",
            errand: errand
        };

    }

    let isPaid = false;
    let isFailed = false;
    let transactionReference = null;

    try {

        if (errand.payment_gateway === "opay") {

            const opayData =
                await queryOpayPaymentStatus(paymentReference);

            isPaid =
                opayData.status === "SUCCESS" &&
                Number(opayData.amount.total) >= Math.round(Number(errand.total_amount) * 100);

            isFailed =
                opayData.status === "FAIL" || opayData.status === "CLOSE";

            transactionReference = opayData.orderNo;

        } else if (errand.payment_gateway === "paystack") {

            const paystackData =
                await verifyPaystackTransaction(paymentReference);

            isPaid =
                paystackData.status === "success" &&
                Number(paystackData.amount) >= Math.round(Number(errand.total_amount) * 100);

            isFailed =
                paystackData.status === "failed" || paystackData.status === "abandoned";

            transactionReference = paystackData.id;

        } else {

            const accessToken =
                await getMonnifyAccessToken();

            const verifyResponse = await fetch(
                MONNIFY_BASE_URL +
                "/api/v2/merchant/transactions/query?paymentReference=" +
                encodeURIComponent(paymentReference),
                {
                    headers: { "Authorization": "Bearer " + accessToken },
                    signal: AbortSignal.timeout(15000)
                }
            );

            const verifyData = await verifyResponse.json();

            if (verifyData.requestSuccessful) {

                const paymentStatus =
                    verifyData.responseBody.paymentStatus;

                const amountPaid =
                    Number(verifyData.responseBody.amountPaid || 0);

                isPaid =
                    (paymentStatus === "PAID" || paymentStatus === "OVERPAID") &&
                    amountPaid >= Number(errand.total_amount);

                isFailed =
                    paymentStatus === "FAILED" ||
                    paymentStatus === "EXPIRED" ||
                    paymentStatus === "REVERSED";

                transactionReference = verifyData.responseBody.transactionReference;

            }

        }

    } catch (error) {

        return {
            success: false,
            message: "Could not verify this payment.",
            errand: errand
        };

    }

    const newStatus =
        isPaid ? "available" : (isFailed ? "failed" : "pending");

    const updated = await pool.query(
        `
        UPDATE errands
        SET status = $1, transaction_reference = $2
        WHERE id = $3
        RETURNING *
        `,
        [newStatus, transactionReference, errand.id]
    );

    return {
        success: isPaid,
        message: isPaid ? "Payment confirmed — your errand is now available to agents." : "Payment not yet confirmed.",
        errand: updated.rows[0]
    };

}

app.post("/api/errands/verify", async (req, res) => {

    try {

        const { paymentReference } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const result =
            await verifyAndUpdateErrandPayment(paymentReference);

        if (!result.errand) {
            return res.status(404).json(result);
        }

        res.status(200).json(result);

    } catch (error) {

        console.error(
            "Errand verify error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while verifying your errand payment."
        });

    }

});


// ========================================
// ERRAND MODE — AVAILABILITY TOGGLE
// ========================================

// ========================================
// SEND AN SMS
// ⚠️ NOT YET CONFIGURED — this app has no
// SMS gateway integrated (only email, via
// Resend). This function currently just
// logs the code to the server console so
// verification is testable in development.
// To actually send real SMS, wire in a
// provider here (e.g. Termii, Africa's
// Talking, or Twilio) using their API —
// same situation as Monnify needing real
// credentials before it can process
// payments.
// ========================================

async function sendPhoneVerificationSms(phone, code) {

    console.log(
        "[SMS NOT CONFIGURED] Would send to " + phone + ": Your Kurios Stores verification code is " + code
    );

    return { sent: false, simulated: true };

}

app.post("/api/students/phone-verify/send", async (req, res) => {

    try {

        const { studentId, phone } = req.body;

        if (!studentId || !phone) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId or phone."
            });

        }

        const code =
            String(crypto.randomInt(100000, 999999));

        const expiresAt =
            new Date(Date.now() + 10 * 60000);

        await pool.query(
            `
            INSERT INTO phone_verification_codes (student_id, phone, code, purpose, expires_at)
            VALUES ($1, $2, $3, 'errand_agent', $4)
            `,
            [studentId, phone, code, expiresAt]
        );

        await sendPhoneVerificationSms(phone, code);

        res.status(200).json({
            success: true,
            message: "A verification code has been sent to your phone."
        });

    } catch (error) {

        console.error(
            "Send phone verification error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not send a verification code."
        });

    }

});

app.post("/api/students/phone-verify/confirm", async (req, res) => {

    try {

        const { studentId, code } = req.body;

        if (!studentId || !code) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId or code."
            });

        }

        const result = await pool.query(
            `
            SELECT * FROM phone_verification_codes
            WHERE student_id = $1
            AND purpose = 'errand_agent'
            AND code = $2
            AND verified_at IS NULL
            AND expires_at > CURRENT_TIMESTAMP
            ORDER BY created_at DESC
            LIMIT 1
            `,
            [studentId, code]
        );

        if (result.rows.length === 0) {

            return res.status(400).json({
                success: false,
                message: "That code is invalid or has expired."
            });

        }

        await pool.query(
            `UPDATE phone_verification_codes SET verified_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [result.rows[0].id]
        );

        await pool.query(
            `UPDATE students SET errand_agent_phone_verified = true WHERE id = $1`,
            [studentId]
        );

        res.status(200).json({
            success: true,
            message: "Phone number verified."
        });

    } catch (error) {

        console.error(
            "Confirm phone verification error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not verify your phone number."
        });

    }

});


// ========================================
// ERRAND AGENT REGISTRATION (₦500)
// ========================================

app.post("/api/errand-agent/register", async (req, res) => {

    try {

        const { studentId, phone, serviceArea } = req.body;

        if (!studentId || !phone) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId or phone."
            });

        }

        const studentResult = await pool.query(
            `SELECT errand_agent_phone_verified, is_errand_agent_registered FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (studentResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student not found."
            });

        }

        const student =
            studentResult.rows[0];

        if (student.is_errand_agent_registered) {

            return res.status(400).json({
                success: false,
                message: "You're already registered as an Errand Agent."
            });

        }

        if (!student.errand_agent_phone_verified) {

            return res.status(400).json({
                success: false,
                message: "Please verify your phone number before registering."
            });

        }

        const paymentReference =
            "kurios_errandagent_" + Date.now() + "_" + crypto.randomInt(100000, 999999);

        await pool.query(
            `
            UPDATE students
            SET phone = COALESCE($1, phone), errand_service_area = $2, errand_agent_payment_reference = $3
            WHERE id = $4
            `,
            [phone, serviceArea || null, paymentReference, studentId]
        );

        res.status(200).json({
            success: true,
            paymentReference: paymentReference,
            amount: 500
        });

    } catch (error) {

        console.error(
            "Errand agent registration error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not start your registration."
        });

    }

});

app.post("/api/errand-agent/pay/:gateway", async (req, res) => {

    try {

        const { gateway } = req.params;
        const { paymentReference, returnUrl, customerName, customerEmail } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const studentResult = await pool.query(
            `SELECT id FROM students WHERE errand_agent_payment_reference = $1 LIMIT 1`,
            [paymentReference]
        );

        if (studentResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Registration not found."
            });

        }

        await pool.query(
            `UPDATE students SET errand_agent_payment_gateway = $1 WHERE errand_agent_payment_reference = $2`,
            [gateway, paymentReference]
        );

        if (gateway === "monnify") {

            return res.status(200).json({
                success: true,
                paymentReference: paymentReference,
                amount: 500,
                apiKey: MONNIFY_API_KEY,
                contractCode: MONNIFY_CONTRACT_CODE
            });

        }

        if (gateway === "opay") {

            const opayData =
                await createOpayCashierPayment({
                    reference: paymentReference,
                    amountNaira: 500,
                    customerName: customerName || "Kurios Student",
                    customerEmail: customerEmail || "",
                    description: "Kurios Stores Errand Agent registration",
                    returnUrl: returnUrl,
                    callbackUrl: OPAY_CALLBACK_URL
                });

            return res.status(200).json({
                success: true,
                cashierUrl: opayData.cashierUrl
            });

        }

        if (gateway === "paystack") {

            const paystackData =
                await initializePaystackTransaction({
                    reference: paymentReference,
                    amountNaira: 500,
                    email: customerEmail,
                    callbackUrl: returnUrl
                });

            return res.status(200).json({
                success: true,
                authorizationUrl: paystackData.authorization_url
            });

        }

        res.status(400).json({
            success: false,
            message: "Unknown payment gateway."
        });

    } catch (error) {

        console.error(
            "Errand agent checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message || "Could not start checkout."
        });

    }

});

async function verifyAndUpdateErrandAgentPayment(paymentReference) {

    const studentResult = await pool.query(
        `SELECT * FROM students WHERE errand_agent_payment_reference = $1 LIMIT 1`,
        [paymentReference]
    );

    if (studentResult.rows.length === 0) {

        return {
            success: false,
            message: "Registration not found.",
            student: null
        };

    }

    const student =
        studentResult.rows[0];

    if (student.is_errand_agent_registered) {

        return {
            success: true,
            message: "Already registered.",
            student: student
        };

    }

    let isPaid = false;

    try {

        if (student.errand_agent_payment_gateway === "opay") {

            const opayData =
                await queryOpayPaymentStatus(paymentReference);

            isPaid =
                opayData.status === "SUCCESS" &&
                Number(opayData.amount.total) >= 50000;

        } else if (student.errand_agent_payment_gateway === "paystack") {

            const paystackData =
                await verifyPaystackTransaction(paymentReference);

            isPaid =
                paystackData.status === "success" &&
                Number(paystackData.amount) >= 50000;

        } else {

            const accessToken =
                await getMonnifyAccessToken();

            const verifyResponse = await fetch(
                MONNIFY_BASE_URL +
                "/api/v2/merchant/transactions/query?paymentReference=" +
                encodeURIComponent(paymentReference),
                {
                    headers: { "Authorization": "Bearer " + accessToken },
                    signal: AbortSignal.timeout(15000)
                }
            );

            const verifyData = await verifyResponse.json();

            if (verifyData.requestSuccessful) {

                const paymentStatus =
                    verifyData.responseBody.paymentStatus;

                isPaid =
                    (paymentStatus === "PAID" || paymentStatus === "OVERPAID") &&
                    Number(verifyData.responseBody.amountPaid || 0) >= 500;

            }

        }

    } catch (error) {

        return {
            success: false,
            message: "Could not verify this payment.",
            student: student
        };

    }

    if (!isPaid) {

        return {
            success: false,
            message: "Payment not yet confirmed.",
            student: student
        };

    }

    const updated = await pool.query(
        `
        UPDATE students
        SET is_errand_agent_registered = true, errand_agent_registered_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
        `,
        [student.id]
    );

    return {
        success: true,
        message: "You're now a registered Errand Agent.",
        student: updated.rows[0]
    };

}

app.post("/api/errand-agent/verify", async (req, res) => {

    try {

        const { paymentReference } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const result =
            await verifyAndUpdateErrandAgentPayment(paymentReference);

        if (!result.student) {
            return res.status(404).json(result);
        }

        res.status(200).json(result);

    } catch (error) {

        console.error(
            "Errand agent verify error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while verifying your registration."
        });

    }

});


// ========================================
// CRAFT PROVIDER REGISTRATION (₦2,000)
// (one registration can cover multiple
// skills)
// ========================================

app.post("/api/craft-providers/register", async (req, res) => {

    try {

        const { studentId, skills, bio } = req.body;

        if (!studentId || !Array.isArray(skills) || skills.length === 0) {

            return res.status(400).json({
                success: false,
                message: "Please select at least one skill."
            });

        }

        const existing = await pool.query(
            `SELECT id, status FROM craft_providers WHERE student_id = $1 LIMIT 1`,
            [studentId]
        );

        if (existing.rows.length > 0 && existing.rows[0].status === "active") {

            return res.status(400).json({
                success: false,
                message: "You're already registered as a Craft provider."
            });

        }

        const paymentReference =
            "kurios_craft_" + Date.now() + "_" + crypto.randomInt(100000, 999999);

        if (existing.rows.length > 0) {

            await pool.query(
                `
                UPDATE craft_providers
                SET skills = $1, bio = $2, payment_reference = $3, status = 'pending'
                WHERE student_id = $4
                `,
                [JSON.stringify(skills), bio || null, paymentReference, studentId]
            );

        } else {

            await pool.query(
                `
                INSERT INTO craft_providers (student_id, skills, bio, payment_reference, status)
                VALUES ($1, $2, $3, $4, 'pending')
                `,
                [studentId, JSON.stringify(skills), bio || null, paymentReference]
            );

        }

        res.status(200).json({
            success: true,
            paymentReference: paymentReference,
            amount: 2000
        });

    } catch (error) {

        console.error(
            "Craft provider registration error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not start your registration."
        });

    }

});

app.post("/api/craft-providers/pay/:gateway", async (req, res) => {

    try {

        const { gateway } = req.params;
        const { paymentReference, returnUrl, customerName, customerEmail } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const providerResult = await pool.query(
            `SELECT id FROM craft_providers WHERE payment_reference = $1 LIMIT 1`,
            [paymentReference]
        );

        if (providerResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Registration not found."
            });

        }

        await pool.query(
            `UPDATE craft_providers SET payment_gateway = $1 WHERE payment_reference = $2`,
            [gateway, paymentReference]
        );

        if (gateway === "monnify") {

            return res.status(200).json({
                success: true,
                paymentReference: paymentReference,
                amount: 2000,
                apiKey: MONNIFY_API_KEY,
                contractCode: MONNIFY_CONTRACT_CODE
            });

        }

        if (gateway === "opay") {

            const opayData =
                await createOpayCashierPayment({
                    reference: paymentReference,
                    amountNaira: 2000,
                    customerName: customerName || "Kurios Student",
                    customerEmail: customerEmail || "",
                    description: "Kurios Stores Craft Errand registration",
                    returnUrl: returnUrl,
                    callbackUrl: OPAY_CALLBACK_URL
                });

            return res.status(200).json({
                success: true,
                cashierUrl: opayData.cashierUrl
            });

        }

        if (gateway === "paystack") {

            const paystackData =
                await initializePaystackTransaction({
                    reference: paymentReference,
                    amountNaira: 2000,
                    email: customerEmail,
                    callbackUrl: returnUrl
                });

            return res.status(200).json({
                success: true,
                authorizationUrl: paystackData.authorization_url
            });

        }

        res.status(400).json({
            success: false,
            message: "Unknown payment gateway."
        });

    } catch (error) {

        console.error(
            "Craft provider checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message || "Could not start checkout."
        });

    }

});

async function verifyAndUpdateCraftProviderPayment(paymentReference) {

    const providerResult = await pool.query(
        `SELECT * FROM craft_providers WHERE payment_reference = $1 LIMIT 1`,
        [paymentReference]
    );

    if (providerResult.rows.length === 0) {

        return {
            success: false,
            message: "Registration not found.",
            provider: null
        };

    }

    const provider =
        providerResult.rows[0];

    if (provider.status === "active") {

        return {
            success: true,
            message: "Already registered.",
            provider: provider
        };

    }

    let isPaid = false;

    try {

        if (provider.payment_gateway === "opay") {

            const opayData =
                await queryOpayPaymentStatus(paymentReference);

            isPaid =
                opayData.status === "SUCCESS" &&
                Number(opayData.amount.total) >= 200000;

        } else if (provider.payment_gateway === "paystack") {

            const paystackData =
                await verifyPaystackTransaction(paymentReference);

            isPaid =
                paystackData.status === "success" &&
                Number(paystackData.amount) >= 200000;

        } else {

            const accessToken =
                await getMonnifyAccessToken();

            const verifyResponse = await fetch(
                MONNIFY_BASE_URL +
                "/api/v2/merchant/transactions/query?paymentReference=" +
                encodeURIComponent(paymentReference),
                {
                    headers: { "Authorization": "Bearer " + accessToken },
                    signal: AbortSignal.timeout(15000)
                }
            );

            const verifyData = await verifyResponse.json();

            if (verifyData.requestSuccessful) {

                const paymentStatus =
                    verifyData.responseBody.paymentStatus;

                isPaid =
                    (paymentStatus === "PAID" || paymentStatus === "OVERPAID") &&
                    Number(verifyData.responseBody.amountPaid || 0) >= 2000;

            }

        }

    } catch (error) {

        return {
            success: false,
            message: "Could not verify this payment.",
            provider: provider
        };

    }

    if (!isPaid) {

        return {
            success: false,
            message: "Payment not yet confirmed.",
            provider: provider
        };

    }

    const updated = await pool.query(
        `UPDATE craft_providers SET status = 'active' WHERE id = $1 RETURNING *`,
        [provider.id]
    );

    return {
        success: true,
        message: "You're now a registered Craft provider.",
        provider: updated.rows[0]
    };

}

app.post("/api/craft-providers/verify", async (req, res) => {

    try {

        const { paymentReference } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const result =
            await verifyAndUpdateCraftProviderPayment(paymentReference);

        if (!result.provider) {
            return res.status(404).json(result);
        }

        res.status(200).json(result);

    } catch (error) {

        console.error(
            "Craft provider verify error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while verifying your registration."
        });

    }

});


app.get("/api/craft-providers/status", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `SELECT status, skills, bio FROM craft_providers WHERE student_id = $1 LIMIT 1`,
            [studentId]
        );

        if (result.rows.length === 0) {

            return res.status(200).json({
                success: true,
                isRegistered: false
            });

        }

        res.status(200).json({
            success: true,
            isRegistered: result.rows[0].status === "active",
            skills: result.rows[0].skills,
            bio: result.rows[0].bio
        });

    } catch (error) {

        console.error(
            "Fetch craft provider status error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your Craft provider status."
        });

    }

});


// ========================================
// CRAFT REQUESTS — CREATE
// (no payment yet — price isn't locked in
// until a provider is actually confirmed,
// since it may change through negotiation)
// ========================================

app.post("/api/craft-requests/create", async (req, res) => {

    try {

        const { studentId, skill, description, location, proposedPrice } = req.body;

        if (!studentId || !skill || !location || !proposedPrice) {

            return res.status(400).json({
                success: false,
                message: "Please fill in the skill, location, and your proposed price."
            });

        }

        if (Number(proposedPrice) < 100) {

            return res.status(400).json({
                success: false,
                message: "Proposed price must be at least ₦100."
            });

        }

        const requestCode =
            "KRS-CFT-" + crypto.randomInt(10000, 99999);

        const result = await pool.query(
            `
            INSERT INTO craft_requests (
                request_code, student_id, skill, description, location, proposed_price, status
            )
            VALUES ($1, $2, $3, $4, $5, $6, 'open')
            RETURNING *
            `,
            [requestCode, studentId, skill.trim(), description ? description.trim() : null, location.trim(), Number(proposedPrice)]
        );

        res.status(201).json({
            success: true,
            request: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Create craft request error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not create your request."
        });

    }

});


// ========================================
// CRAFT REQUESTS — PROVIDER DASHBOARD
// (open requests matching the provider's
// registered skills, plus ones they've
// already made an offer on)
// ========================================

app.get("/api/craft-requests/dashboard", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const providerResult = await pool.query(
            `SELECT skills, status FROM craft_providers WHERE student_id = $1 LIMIT 1`,
            [studentId]
        );

        if (providerResult.rows.length === 0 || providerResult.rows[0].status !== "active") {

            return res.status(403).json({
                success: false,
                message: "Only registered Craft providers can view this dashboard."
            });

        }

        const skills =
            providerResult.rows[0].skills || [];

        if (skills.length === 0) {

            return res.status(200).json({
                success: true,
                requests: []
            });

        }

        const result = await pool.query(
            `
            SELECT
                craft_requests.*,
                (
                    SELECT offered_price FROM craft_offers
                    WHERE request_id = craft_requests.id AND provider_id = $2
                ) AS my_offer_price,
                (
                    SELECT status FROM craft_offers
                    WHERE request_id = craft_requests.id AND provider_id = $2
                ) AS my_offer_status
            FROM craft_requests
            WHERE craft_requests.status = 'open'
            AND craft_requests.skill = ANY($1::text[])
            AND craft_requests.student_id != $2
            ORDER BY craft_requests.created_at ASC
            `,
            [skills, studentId]
        );

        res.status(200).json({
            success: true,
            requests: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch craft dashboard error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load the Craft Errands dashboard."
        });

    }

});


// ========================================
// CRAFT REQUESTS — MAKE AN OFFER
// (accepting at the proposed price assigns
// immediately, atomically — countering
// requires the student to approve it)
// ========================================

app.post("/api/craft-requests/:id/offer", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId, offeredPrice } = req.body;

        if (!studentId || !offeredPrice || Number(offeredPrice) < 100) {

            return res.status(400).json({
                success: false,
                message: "Please enter a valid price."
            });

        }

        const providerResult = await pool.query(
            `SELECT status FROM craft_providers WHERE student_id = $1 LIMIT 1`,
            [studentId]
        );

        if (providerResult.rows.length === 0 || providerResult.rows[0].status !== "active") {

            return res.status(403).json({
                success: false,
                message: "Only registered Craft providers can make offers."
            });

        }

        const requestResult = await pool.query(
            `SELECT * FROM craft_requests WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (requestResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Request not found."
            });

        }

        const craftRequest =
            requestResult.rows[0];

        if (craftRequest.status !== "open") {

            return res.status(409).json({
                success: false,
                message: "This request is no longer open."
            });

        }

        const isAcceptingProposedPrice =
            Number(offeredPrice) === Number(craftRequest.proposed_price);

        if (isAcceptingProposedPrice) {

            // Accepting at face value assigns immediately,
            // atomically — same locking pattern as regular
            // errand accept, so two providers can't both win.

            const deliveryOtp =
                String(crypto.randomInt(1000, 9999));

            const commission =
                Math.round(Number(craftRequest.proposed_price) * 0.20 * 100) / 100;

            const providerEarnings =
                Number(craftRequest.proposed_price) - commission;

            const paymentReference =
                "kurios_craftreq_" + Date.now() + "_" + crypto.randomInt(100000, 999999);

            const assignResult = await pool.query(
                `
                UPDATE craft_requests
                SET status = 'assigned', assigned_provider_id = $1, agreed_price = $2, kurios_commission = $3, provider_earnings = $4, assigned_at = CURRENT_TIMESTAMP, delivery_otp = $5, payment_reference = $6
                WHERE id = $7 AND status = 'open'
                RETURNING *
                `,
                [studentId, craftRequest.proposed_price, commission, providerEarnings, deliveryOtp, paymentReference, id]
            );

            if (assignResult.rows.length === 0) {

                return res.status(409).json({
                    success: false,
                    message: "This request was just taken by another provider."
                });

            }

            const assigned =
                assignResult.rows[0];

            const conversationId =
                await findOrCreateConversation(assigned.student_id, studentId, "CRAFT", assigned.id);

            await pool.query(
                `UPDATE craft_requests SET conversation_id = $1 WHERE id = $2`,
                [conversationId, assigned.id]
            );

            return res.status(200).json({
                success: true,
                assigned: true,
                request: Object.assign({}, assigned, { conversation_id: conversationId })
            });

        }

        // Otherwise it's a counter-offer — record it,
        // request stays open, student must approve.

        await pool.query(
            `
            INSERT INTO craft_offers (request_id, provider_id, offered_price, is_counter, status)
            VALUES ($1, $2, $3, true, 'pending')
            ON CONFLICT (request_id, provider_id)
            DO UPDATE SET offered_price = EXCLUDED.offered_price, is_counter = true, status = 'pending'
            `,
            [id, studentId, Number(offeredPrice)]
        );

        res.status(200).json({
            success: true,
            assigned: false,
            message: "Your counter-offer has been sent to the student."
        });

    } catch (error) {

        console.error(
            "Make craft offer error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not submit your offer."
        });

    }

});


// ========================================
// CRAFT REQUESTS — VIEW OFFERS
// (student reviewing counter-offers on
// their own request)
// ========================================

app.get("/api/craft-requests/:id/offers", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId } = req.query;

        const requestResult = await pool.query(
            `SELECT student_id FROM craft_requests WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (requestResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Request not found."
            });

        }

        if (String(requestResult.rows[0].student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your request."
            });

        }

        const result = await pool.query(
            `
            SELECT
                craft_offers.*,
                students.first_name,
                students.last_name
            FROM craft_offers
            JOIN students ON students.id = craft_offers.provider_id
            WHERE craft_offers.request_id = $1
            AND craft_offers.status = 'pending'
            ORDER BY craft_offers.created_at ASC
            `,
            [id]
        );

        res.status(200).json({
            success: true,
            offers: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch craft offers error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load offers for this request."
        });

    }

});


// ========================================
// CRAFT REQUESTS — APPROVE A COUNTER-OFFER
// (student picks one, atomically assigns
// that provider and rejects the rest)
// ========================================

app.post("/api/craft-requests/:id/offers/:offerId/approve", async (req, res) => {

    try {

        const { id, offerId } = req.params;
        const { studentId } = req.body;

        const requestResult = await pool.query(
            `SELECT * FROM craft_requests WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (requestResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Request not found."
            });

        }

        const craftRequest =
            requestResult.rows[0];

        if (String(craftRequest.student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your request."
            });

        }

        if (craftRequest.status !== "open") {

            return res.status(409).json({
                success: false,
                message: "This request is no longer open."
            });

        }

        const offerResult = await pool.query(
            `SELECT * FROM craft_offers WHERE id = $1 AND request_id = $2 AND status = 'pending' LIMIT 1`,
            [offerId, id]
        );

        if (offerResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "That offer is no longer available."
            });

        }

        const offer =
            offerResult.rows[0];

        const deliveryOtp =
            String(crypto.randomInt(1000, 9999));

        const commission =
            Math.round(Number(offer.offered_price) * 0.20 * 100) / 100;

        const providerEarnings =
            Number(offer.offered_price) - commission;

        const paymentReference =
            "kurios_craftreq_" + Date.now() + "_" + crypto.randomInt(100000, 999999);

        const assignResult = await pool.query(
            `
            UPDATE craft_requests
            SET status = 'assigned', assigned_provider_id = $1, agreed_price = $2, kurios_commission = $3, provider_earnings = $4, assigned_at = CURRENT_TIMESTAMP, delivery_otp = $5, payment_reference = $6
            WHERE id = $7 AND status = 'open'
            RETURNING *
            `,
            [offer.provider_id, offer.offered_price, commission, providerEarnings, deliveryOtp, paymentReference, id]
        );

        if (assignResult.rows.length === 0) {

            return res.status(409).json({
                success: false,
                message: "This request is no longer open."
            });

        }

        await pool.query(
            `UPDATE craft_offers SET status = 'approved' WHERE id = $1`,
            [offerId]
        );

        await pool.query(
            `UPDATE craft_offers SET status = 'rejected' WHERE request_id = $1 AND id != $2 AND status = 'pending'`,
            [id, offerId]
        );

        const assigned =
            assignResult.rows[0];

        const conversationId =
            await findOrCreateConversation(assigned.student_id, offer.provider_id, "CRAFT", assigned.id);

        await pool.query(
            `UPDATE craft_requests SET conversation_id = $1 WHERE id = $2`,
            [conversationId, assigned.id]
        );

        res.status(200).json({
            success: true,
            request: Object.assign({}, assigned, { conversation_id: conversationId })
        });

    } catch (error) {

        console.error(
            "Approve craft offer error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not approve this offer."
        });

    }

});


// ========================================
// CRAFT REQUESTS — MY REQUESTS
// (as the requesting student)
// ========================================

app.get("/api/craft-requests/my", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `
            SELECT
                craft_requests.*,
                (
                    SELECT COUNT(*)::int FROM craft_offers
                    WHERE request_id = craft_requests.id AND status = 'pending' AND is_counter = true
                ) AS pending_offer_count
            FROM craft_requests
            WHERE student_id = $1
            ORDER BY created_at DESC
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            requests: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch my craft requests error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your Craft requests."
        });

    }

});


// ========================================
// CRAFT REQUESTS — MY JOBS
// (as the assigned provider)
// ========================================

app.get("/api/craft-requests/my-jobs", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `
            SELECT *
            FROM craft_requests
            WHERE assigned_provider_id = $1
            AND status NOT IN ('completed', 'cancelled')
            ORDER BY assigned_at DESC
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            requests: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch my craft jobs error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your Craft jobs."
        });

    }

});


// ========================================
// CRAFT REQUESTS — PAY (student)
// ========================================

app.post("/api/craft-requests/:id/pay/:gateway", async (req, res) => {

    try {

        const { id, gateway } = req.params;
        const { studentId, returnUrl, customerName, customerEmail } = req.body;

        const requestResult = await pool.query(
            `SELECT * FROM craft_requests WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (requestResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Request not found."
            });

        }

        const craftRequest =
            requestResult.rows[0];

        if (String(craftRequest.student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your request."
            });

        }

        if (craftRequest.payment_status === "paid") {

            return res.status(400).json({
                success: false,
                message: "This request is already paid for."
            });

        }

        if (craftRequest.status !== "assigned") {

            return res.status(400).json({
                success: false,
                message: "This request isn't ready for payment yet."
            });

        }

        await pool.query(
            `UPDATE craft_requests SET payment_gateway = $1 WHERE id = $2`,
            [gateway, id]
        );

        const amount =
            Number(craftRequest.agreed_price);

        if (gateway === "monnify") {

            return res.status(200).json({
                success: true,
                paymentReference: craftRequest.payment_reference,
                amount: amount,
                apiKey: MONNIFY_API_KEY,
                contractCode: MONNIFY_CONTRACT_CODE
            });

        }

        if (gateway === "opay") {

            const opayData =
                await createOpayCashierPayment({
                    reference: craftRequest.payment_reference,
                    amountNaira: amount,
                    customerName: customerName || "Kurios Student",
                    customerEmail: customerEmail || "",
                    description: "Kurios Stores Craft Errand — " + craftRequest.skill,
                    returnUrl: returnUrl,
                    callbackUrl: OPAY_CALLBACK_URL
                });

            return res.status(200).json({
                success: true,
                cashierUrl: opayData.cashierUrl
            });

        }

        if (gateway === "paystack") {

            const paystackData =
                await initializePaystackTransaction({
                    reference: craftRequest.payment_reference,
                    amountNaira: amount,
                    email: customerEmail,
                    callbackUrl: returnUrl
                });

            return res.status(200).json({
                success: true,
                authorizationUrl: paystackData.authorization_url
            });

        }

        res.status(400).json({
            success: false,
            message: "Unknown payment gateway."
        });

    } catch (error) {

        console.error(
            "Craft request checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message || "Could not start checkout."
        });

    }

});


// ========================================
// CRAFT REQUESTS — VERIFY PAYMENT
// ========================================

async function verifyAndUpdateCraftRequestPayment(paymentReference) {

    const requestResult = await pool.query(
        `SELECT * FROM craft_requests WHERE payment_reference = $1 LIMIT 1`,
        [paymentReference]
    );

    if (requestResult.rows.length === 0) {

        return {
            success: false,
            message: "Request not found.",
            request: null
        };

    }

    const craftRequest =
        requestResult.rows[0];

    if (craftRequest.payment_status === "paid") {

        return {
            success: true,
            message: "Already paid.",
            request: craftRequest
        };

    }

    let isPaid = false;
    let transactionReference = null;

    try {

        if (craftRequest.payment_gateway === "opay") {

            const opayData =
                await queryOpayPaymentStatus(paymentReference);

            isPaid =
                opayData.status === "SUCCESS" &&
                Number(opayData.amount.total) >= Math.round(Number(craftRequest.agreed_price) * 100);

            transactionReference = opayData.orderNo;

        } else if (craftRequest.payment_gateway === "paystack") {

            const paystackData =
                await verifyPaystackTransaction(paymentReference);

            isPaid =
                paystackData.status === "success" &&
                Number(paystackData.amount) >= Math.round(Number(craftRequest.agreed_price) * 100);

            transactionReference = paystackData.id;

        } else {

            const accessToken =
                await getMonnifyAccessToken();

            const verifyResponse = await fetch(
                MONNIFY_BASE_URL +
                "/api/v2/merchant/transactions/query?paymentReference=" +
                encodeURIComponent(paymentReference),
                {
                    headers: { "Authorization": "Bearer " + accessToken },
                    signal: AbortSignal.timeout(15000)
                }
            );

            const verifyData = await verifyResponse.json();

            if (verifyData.requestSuccessful) {

                const paymentStatus =
                    verifyData.responseBody.paymentStatus;

                isPaid =
                    (paymentStatus === "PAID" || paymentStatus === "OVERPAID") &&
                    Number(verifyData.responseBody.amountPaid || 0) >= Number(craftRequest.agreed_price);

                transactionReference = verifyData.responseBody.transactionReference;

            }

        }

    } catch (error) {

        return {
            success: false,
            message: "Could not verify this payment.",
            request: craftRequest
        };

    }

    if (!isPaid) {

        return {
            success: false,
            message: "Payment not yet confirmed.",
            request: craftRequest
        };

    }

    const updated = await pool.query(
        `
        UPDATE craft_requests
        SET payment_status = 'paid', transaction_reference = $1
        WHERE id = $2
        RETURNING *
        `,
        [transactionReference, craftRequest.id]
    );

    return {
        success: true,
        message: "Payment confirmed.",
        request: updated.rows[0]
    };

}

app.post("/api/craft-requests/verify", async (req, res) => {

    try {

        const { paymentReference } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const result =
            await verifyAndUpdateCraftRequestPayment(paymentReference);

        if (!result.request) {
            return res.status(404).json(result);
        }

        res.status(200).json(result);

    } catch (error) {

        console.error(
            "Craft request verify error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while verifying this payment."
        });

    }

});


// ========================================
// CRAFT REQUESTS — START SERVICE (provider)
// (requires payment to be confirmed first)
// ========================================

app.post("/api/craft-requests/:id/start", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId } = req.body;

        const requestResult = await pool.query(
            `SELECT * FROM craft_requests WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (requestResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Request not found."
            });

        }

        const craftRequest =
            requestResult.rows[0];

        if (String(craftRequest.assigned_provider_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "Only the assigned provider can start this service."
            });

        }

        if (craftRequest.payment_status !== "paid") {

            return res.status(400).json({
                success: false,
                message: "Waiting on the student to complete payment first."
            });

        }

        if (craftRequest.status !== "assigned") {

            return res.status(400).json({
                success: false,
                message: "This request isn't at the right stage to start."
            });

        }

        const updated = await pool.query(
            `UPDATE craft_requests SET status = 'in_progress' WHERE id = $1 RETURNING *`,
            [id]
        );

        res.status(200).json({
            success: true,
            request: updated.rows[0]
        });

    } catch (error) {

        console.error(
            "Start craft service error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not start this service."
        });

    }

});


// ========================================
// CRAFT REQUESTS — CONFIRM COMPLETION (OTP)
// ========================================

app.post("/api/craft-requests/:id/confirm-completion", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId, otp } = req.body;

        if (!studentId || !otp) {

            return res.status(400).json({
                success: false,
                message: "Please enter the completion code."
            });

        }

        const requestResult = await pool.query(
            `SELECT * FROM craft_requests WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (requestResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Request not found."
            });

        }

        const craftRequest =
            requestResult.rows[0];

        if (String(craftRequest.assigned_provider_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "Only the assigned provider can confirm completion."
            });

        }

        if (craftRequest.status !== "in_progress") {

            return res.status(400).json({
                success: false,
                message: "Start the service before confirming completion."
            });

        }

        if (String(otp).trim() !== String(craftRequest.delivery_otp)) {

            return res.status(400).json({
                success: false,
                message: "That code doesn't match. Please check with the student."
            });

        }

        await pool.query(
            `UPDATE students SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE id = $2`,
            [Number(craftRequest.provider_earnings), craftRequest.assigned_provider_id]
        );

        const updated = await pool.query(
            `
            UPDATE craft_requests
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
            `,
            [id]
        );

        res.status(200).json({
            success: true,
            request: updated.rows[0],
            released: Number(craftRequest.provider_earnings)
        });

    } catch (error) {

        console.error(
            "Confirm craft completion error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not confirm completion."
        });

    }

});


// ========================================
// CRAFT REQUESTS — CANCEL (student-initiated)
// ========================================

app.post("/api/craft-requests/:id/cancel", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId, reason } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const requestResult = await pool.query(
            `SELECT * FROM craft_requests WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (requestResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Request not found."
            });

        }

        const craftRequest =
            requestResult.rows[0];

        if (String(craftRequest.student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your request."
            });

        }

        if (["completed", "cancelled"].includes(craftRequest.status)) {

            return res.status(400).json({
                success: false,
                message: "This request can no longer be cancelled."
            });

        }

        if (craftRequest.status === "in_progress") {

            return res.status(400).json({
                success: false,
                message: "The service has already started — try messaging your provider instead."
            });

        }

        let refundAmount = 0;

        if (craftRequest.payment_status === "paid") {
            refundAmount = Number(craftRequest.agreed_price);
        }

        if (refundAmount > 0) {

            await pool.query(
                `UPDATE students SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE id = $2`,
                [refundAmount, studentId]
            );

        }

        const updated = await pool.query(
            `
            UPDATE craft_requests
            SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
            `,
            [id]
        );

        res.status(200).json({
            success: true,
            request: updated.rows[0],
            refunded: refundAmount
        });

    } catch (error) {

        console.error(
            "Cancel craft request error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not cancel this request."
        });

    }

});


// ========================================
// CRAFT REQUESTS — RATE THE PROVIDER
// ========================================

app.post("/api/craft-requests/:id/rate", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId, rating, comment } = req.body;

        if (!studentId || !rating || Number(rating) < 1 || Number(rating) > 5) {

            return res.status(400).json({
                success: false,
                message: "Please give a rating between 1 and 5 stars."
            });

        }

        const requestResult = await pool.query(
            `SELECT * FROM craft_requests WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (requestResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Request not found."
            });

        }

        const craftRequest =
            requestResult.rows[0];

        if (String(craftRequest.student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your request."
            });

        }

        if (craftRequest.status !== "completed") {

            return res.status(400).json({
                success: false,
                message: "You can only rate a completed job."
            });

        }

        if (craftRequest.rating) {

            return res.status(400).json({
                success: false,
                message: "You've already rated this job."
            });

        }

        await pool.query(
            `UPDATE craft_requests SET rating = $1, rating_comment = $2 WHERE id = $3`,
            [Number(rating), comment || null, id]
        );

        await pool.query(
            `
            UPDATE students
            SET
                errand_rating_total = COALESCE(errand_rating_total, 0) + $1,
                errand_rating_count = COALESCE(errand_rating_count, 0) + 1
            WHERE id = $2
            `,
            [Number(rating), craftRequest.assigned_provider_id]
        );

        res.status(200).json({
            success: true,
            message: "Thanks for rating your provider!"
        });

    } catch (error) {

        console.error(
            "Rate craft request error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not submit your rating."
        });

    }

});


app.get("/api/students/errand-mode", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `SELECT errand_mode_available, errand_available_until, errand_service_area, is_errand_agent_registered FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student not found."
            });

        }

        const student =
            result.rows[0];

        const stillAvailable =
            student.errand_mode_available &&
            (!student.errand_available_until || new Date(student.errand_available_until) > new Date());

        res.status(200).json({
            success: true,
            available: stillAvailable,
            availableUntil: student.errand_available_until,
            serviceArea: student.errand_service_area,
            isRegistered: student.is_errand_agent_registered
        });

    } catch (error) {

        console.error(
            "Fetch errand mode status error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your errand availability."
        });

    }

});

app.post("/api/students/errand-mode", async (req, res) => {

    try {

        const { studentId, available, durationMinutes, serviceArea } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const studentCheck = await pool.query(
            `SELECT email_verified, is_suspended, is_errand_agent_registered FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (studentCheck.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student not found."
            });

        }

        const student =
            studentCheck.rows[0];

        if (available && (!student.email_verified || student.is_suspended)) {

            return res.status(403).json({
                success: false,
                message: "Your account isn't eligible for Errand Mode right now."
            });

        }

        if (available && !student.is_errand_agent_registered) {

            return res.status(403).json({
                success: false,
                message: "Please register as an Errand Agent before turning on Errand Mode."
            });

        }

        const availableUntil =
            available && durationMinutes ?
                new Date(Date.now() + Number(durationMinutes) * 60000) :
                null;

        const result = await pool.query(
            `
            UPDATE students
            SET
                errand_mode_available = $1,
                errand_available_until = $2,
                errand_service_area = COALESCE($3, errand_service_area)
            WHERE id = $4
            RETURNING id, errand_mode_available, errand_available_until, errand_service_area
            `,
            [!!available, availableUntil, serviceArea || null, studentId]
        );

        res.status(200).json({
            success: true,
            errandMode: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Toggle errand mode error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not update your errand availability."
        });

    }

});


// ========================================
// ERRANDS — AVAILABLE POOL
// (privacy-safe — no requester identity
// revealed until the errand is accepted)
// ========================================

app.get("/api/errands/pool", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const studentCheck = await pool.query(
            `SELECT errand_mode_available, errand_available_until FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (studentCheck.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student not found."
            });

        }

        const student =
            studentCheck.rows[0];

        const stillAvailable =
            student.errand_mode_available &&
            (!student.errand_available_until || new Date(student.errand_available_until) > new Date());

        if (!stillAvailable) {

            return res.status(200).json({
                success: true,
                errands: [],
                message: "Turn on Errand Mode to see available errands."
            });

        }

        const result = await pool.query(
            `
            SELECT
                id, errand_code, title, pickup_location, destination,
                errand_fee, item_cost, total_amount, created_at
            FROM errands
            WHERE status = 'available'
            AND student_id != $1
            ORDER BY created_at ASC
            LIMIT 30
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            errands: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch errand pool error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load available errands."
        });

    }

});


// ========================================
// ERRANDS — ACCEPT (ATOMIC)
// The WHERE clause here IS the locking
// mechanism — only one concurrent request
// can match status='available' AND
// agent_id IS NULL, so simultaneous
// acceptance attempts can never both win.
// ========================================

app.post("/api/errands/:id/accept", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const agentCheck = await pool.query(
            `SELECT errand_mode_available, errand_available_until, is_errand_agent_registered FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (agentCheck.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student not found."
            });

        }

        const agent =
            agentCheck.rows[0];

        if (!agent.is_errand_agent_registered) {

            return res.status(403).json({
                success: false,
                message: "Please register as an Errand Agent before accepting errands."
            });

        }

        const stillAvailable =
            agent.errand_mode_available &&
            (!agent.errand_available_until || new Date(agent.errand_available_until) > new Date());

        if (!stillAvailable) {

            return res.status(403).json({
                success: false,
                message: "Turn on Errand Mode to accept errands."
            });

        }

        const deliveryOtp =
            String(crypto.randomInt(1000, 9999));

        const claimResult = await pool.query(
            `
            UPDATE errands
            SET status = 'accepted', agent_id = $1, accepted_at = CURRENT_TIMESTAMP, delivery_otp = $3
            WHERE id = $2 AND status = 'available' AND agent_id IS NULL AND student_id != $1
            RETURNING *
            `,
            [studentId, id, deliveryOtp]
        );

        if (claimResult.rows.length === 0) {

            return res.status(409).json({
                success: false,
                message: "This errand has already been taken."
            });

        }

        const errand =
            claimResult.rows[0];

        // Open a real chat thread between student and agent,
        // scoped to this errand.

        const conversationId =
            await findOrCreateConversation(errand.student_id, studentId, "ERRAND", errand.id);

        await pool.query(
            `UPDATE errands SET conversation_id = $1 WHERE id = $2`,
            [conversationId, errand.id]
        );

        res.status(200).json({
            success: true,
            errand: Object.assign({}, errand, { conversation_id: conversationId })
        });

    } catch (error) {

        console.error(
            "Accept errand error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not accept this errand."
        });

    }

});


// ========================================
// ERRANDS — MY REQUESTS
// (as the requesting student)
// ========================================

app.get("/api/errands/my", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `
            SELECT *
            FROM errands
            WHERE student_id = $1
            ORDER BY created_at DESC
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            errands: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch my errands error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your errand requests."
        });

    }

});


// ========================================
// ERRANDS — MY ACTIVE TASKS
// (as the acting agent, not the requester)
// ========================================

app.get("/api/errands/my-tasks", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `
            SELECT *
            FROM errands
            WHERE agent_id = $1
            AND status NOT IN ('completed', 'cancelled', 'failed')
            ORDER BY accepted_at DESC
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            errands: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch my errand tasks error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your active errand tasks."
        });

    }

});


// ========================================
// ERRANDS — AGENT REPORTS THE ACTUAL
// ITEM COST (once known, at the store)
// ========================================

app.post("/api/errands/:id/report-item-cost", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId, itemCost } = req.body;

        if (!studentId || !itemCost || Number(itemCost) <= 0) {

            return res.status(400).json({
                success: false,
                message: "Please enter a valid item cost."
            });

        }

        const errandResult = await pool.query(
            `SELECT * FROM errands WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (errandResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Errand not found."
            });

        }

        const errand =
            errandResult.rows[0];

        if (String(errand.agent_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "Only the assigned agent can report the item cost."
            });

        }

        if (!["accepted", "in_progress"].includes(errand.status)) {

            return res.status(400).json({
                success: false,
                message: "This errand isn't in a stage where item cost can be reported."
            });

        }

        const itemCostReference =
            "kurios_errand_item_" + Date.now() + "_" + crypto.randomInt(100000, 999999);

        const updated = await pool.query(
            `
            UPDATE errands
            SET item_cost = $1, item_cost_status = 'awaiting_payment', item_cost_payment_reference = $2
            WHERE id = $3
            RETURNING *
            `,
            [Number(itemCost), itemCostReference, id]
        );

        if (errand.conversation_id) {

            await pool.query(
                `
                INSERT INTO messages (sender_id, recipient_id, body, conversation_id, message_type)
                VALUES ($1, $2, $3, $4, 'TEXT')
                `,
                [
                    studentId,
                    errand.student_id,
                    "The item cost came to ₦" + Number(itemCost).toLocaleString() + ". Please pay this in the Errands page so I can go ahead.",
                    errand.conversation_id
                ]
            );

            if (typeof io !== "undefined") {

                io.to("student:" + errand.student_id).emit(
                    "new_message",
                    { conversation_id: errand.conversation_id }
                );

            }

        }

        res.status(200).json({
            success: true,
            errand: updated.rows[0]
        });

    } catch (error) {

        console.error(
            "Report item cost error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not report the item cost."
        });

    }

});


// ========================================
// ERRANDS — STUDENT PAYS THE REPORTED
// ITEM COST
// ========================================

app.post("/api/errands/:id/pay-item-cost/:gateway", async (req, res) => {

    try {

        const { id, gateway } = req.params;
        const { returnUrl, customerName, customerEmail } = req.body;

        const errandResult = await pool.query(
            `SELECT * FROM errands WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (errandResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Errand not found."
            });

        }

        const errand =
            errandResult.rows[0];

        if (errand.item_cost_status !== "awaiting_payment") {

            return res.status(400).json({
                success: false,
                message: "There's no item cost awaiting payment on this errand."
            });

        }

        const paymentReference =
            errand.item_cost_payment_reference;

        await pool.query(
            `UPDATE errands SET item_cost_payment_gateway = $1 WHERE id = $2`,
            [gateway, errand.id]
        );

        if (gateway === "monnify") {

            return res.status(200).json({
                success: true,
                paymentReference: paymentReference,
                amount: Number(errand.item_cost),
                apiKey: MONNIFY_API_KEY,
                contractCode: MONNIFY_CONTRACT_CODE
            });

        }

        if (gateway === "opay") {

            const opayData =
                await createOpayCashierPayment({
                    reference: paymentReference,
                    amountNaira: Number(errand.item_cost),
                    customerName: customerName || "Kurios Student",
                    customerEmail: customerEmail || "",
                    description: "Kurios Stores errand item cost — " + errand.title,
                    returnUrl: returnUrl,
                    callbackUrl: OPAY_CALLBACK_URL
                });

            return res.status(200).json({
                success: true,
                cashierUrl: opayData.cashierUrl
            });

        }

        if (gateway === "paystack") {

            const paystackData =
                await initializePaystackTransaction({
                    reference: paymentReference,
                    amountNaira: Number(errand.item_cost),
                    email: customerEmail,
                    callbackUrl: returnUrl
                });

            return res.status(200).json({
                success: true,
                authorizationUrl: paystackData.authorization_url
            });

        }

        res.status(400).json({
            success: false,
            message: "Unknown payment gateway."
        });

    } catch (error) {

        console.error(
            "Errand item cost checkout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: error.message || "Could not start checkout."
        });

    }

});


// ========================================
// ERRANDS — VERIFY ITEM COST PAYMENT
// ========================================

async function verifyAndUpdateErrandItemCostPayment(paymentReference) {

    const errandResult = await pool.query(
        `SELECT * FROM errands WHERE item_cost_payment_reference = $1 LIMIT 1`,
        [paymentReference]
    );

    if (errandResult.rows.length === 0) {

        return {
            success: false,
            message: "Errand not found.",
            errand: null
        };

    }

    const errand =
        errandResult.rows[0];

    if (errand.item_cost_status === "paid") {

        return {
            success: true,
            message: "Item cost already confirmed.",
            errand: errand
        };

    }

    let isPaid = false;

    try {

        if (errand.item_cost_payment_gateway === "opay") {

            const opayData =
                await queryOpayPaymentStatus(paymentReference);

            isPaid =
                opayData.status === "SUCCESS" &&
                Number(opayData.amount.total) >= Math.round(Number(errand.item_cost) * 100);

        } else if (errand.item_cost_payment_gateway === "paystack") {

            const paystackData =
                await verifyPaystackTransaction(paymentReference);

            isPaid =
                paystackData.status === "success" &&
                Number(paystackData.amount) >= Math.round(Number(errand.item_cost) * 100);

        } else {

            const accessToken =
                await getMonnifyAccessToken();

            const verifyResponse = await fetch(
                MONNIFY_BASE_URL +
                "/api/v2/merchant/transactions/query?paymentReference=" +
                encodeURIComponent(paymentReference),
                {
                    headers: { "Authorization": "Bearer " + accessToken },
                    signal: AbortSignal.timeout(15000)
                }
            );

            const verifyData = await verifyResponse.json();

            if (verifyData.requestSuccessful) {

                const paymentStatus =
                    verifyData.responseBody.paymentStatus;

                const amountPaid =
                    Number(verifyData.responseBody.amountPaid || 0);

                isPaid =
                    (paymentStatus === "PAID" || paymentStatus === "OVERPAID") &&
                    amountPaid >= Number(errand.item_cost);

            }

        }

    } catch (error) {

        return {
            success: false,
            message: "Could not verify this payment.",
            errand: errand
        };

    }

    if (!isPaid) {

        return {
            success: false,
            message: "Payment not yet confirmed.",
            errand: errand
        };

    }

    const updated = await pool.query(
        `UPDATE errands SET item_cost_status = 'paid' WHERE id = $1 RETURNING *`,
        [errand.id]
    );

    return {
        success: true,
        message: "Item cost payment confirmed.",
        errand: updated.rows[0]
    };

}

app.post("/api/errands/item-cost/verify", async (req, res) => {

    try {

        const { paymentReference } = req.body;

        if (!paymentReference) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference."
            });

        }

        const result =
            await verifyAndUpdateErrandItemCostPayment(paymentReference);

        if (!result.errand) {
            return res.status(404).json(result);
        }

        res.status(200).json(result);

    } catch (error) {

        console.error(
            "Errand item cost verify error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Something went wrong while verifying this payment."
        });

    }

});


// ========================================
// ERRANDS — EXECUTION STATUS TRANSITIONS
// (agent-only, ownership-checked, and each
// only allowed from its correct prior state
// so steps can't be skipped or reordered)
// ========================================

const ERRAND_STATUS_TRANSITIONS = {
    start: { from: "accepted", to: "in_progress", column: "started_at" },
    "picked-up": { from: "in_progress", to: "picked_up", column: "picked_up_at" },
    "on-way": { from: "picked_up", to: "on_way", column: "on_way_at" },
    arrived: { from: "on_way", to: "arrived", column: "arrived_at" }
};

async function handleErrandStatusTransition(action, req, res) {

    try {

        const { id } = req.params;
        const { studentId } = req.body;

        const transition =
            ERRAND_STATUS_TRANSITIONS[action];

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const errandResult = await pool.query(
            `SELECT * FROM errands WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (errandResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Errand not found."
            });

        }

        const errand =
            errandResult.rows[0];

        if (String(errand.agent_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "Only the assigned agent can update this errand."
            });

        }

        if (errand.status !== transition.from) {

            return res.status(400).json({
                success: false,
                message: "This errand isn't at the right stage for that action."
            });

        }

        const updated = await pool.query(
            `
            UPDATE errands
            SET status = $1, ${transition.column} = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
            `,
            [transition.to, id]
        );

        res.status(200).json({
            success: true,
            errand: updated.rows[0]
        });

    } catch (error) {

        console.error(
            "Update errand status error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not update this errand."
        });

    }

}

app.post("/api/errands/:id/start", (req, res) => handleErrandStatusTransition("start", req, res));
app.post("/api/errands/:id/picked-up", (req, res) => handleErrandStatusTransition("picked-up", req, res));
app.post("/api/errands/:id/on-way", (req, res) => handleErrandStatusTransition("on-way", req, res));
app.post("/api/errands/:id/arrived", (req, res) => handleErrandStatusTransition("arrived", req, res));


// ========================================
// ERRANDS — CONFIRM DELIVERY (OTP)
// This is the escrow release point — the
// student's OTP is the confirmation from
// both sides: the agent physically handed
// it over, and the student gave the code.
// ========================================

app.post("/api/errands/:id/confirm-delivery", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId, otp } = req.body;

        if (!studentId || !otp) {

            return res.status(400).json({
                success: false,
                message: "Please enter the delivery code."
            });

        }

        const errandResult = await pool.query(
            `SELECT * FROM errands WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (errandResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Errand not found."
            });

        }

        const errand =
            errandResult.rows[0];

        if (String(errand.agent_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "Only the assigned agent can confirm delivery."
            });

        }

        if (errand.status !== "arrived") {

            return res.status(400).json({
                success: false,
                message: "Mark the errand as arrived before confirming delivery."
            });

        }

        if (String(otp).trim() !== String(errand.delivery_otp)) {

            return res.status(400).json({
                success: false,
                message: "That code doesn't match. Please check with the student."
            });

        }

        // Release earnings: the errand fee's agent share,
        // plus a full reimbursement of the item cost if one
        // was reported and actually paid through the app.

        const itemCostReimbursement =
            errand.item_cost_status === "paid" ? Number(errand.item_cost) : 0;

        const totalRelease =
            Number(errand.agent_earnings) + itemCostReimbursement;

        await pool.query(
            `UPDATE students SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE id = $2`,
            [totalRelease, errand.agent_id]
        );

        await pool.query(
            `
            UPDATE students
            SET errand_completed_count = COALESCE(errand_completed_count, 0) + 1
            WHERE id = $1
            `,
            [errand.agent_id]
        );

        const updated = await pool.query(
            `
            UPDATE errands
            SET status = 'completed', completed_at = CURRENT_TIMESTAMP
            WHERE id = $1
            RETURNING *
            `,
            [id]
        );

        res.status(200).json({
            success: true,
            errand: updated.rows[0],
            released: totalRelease
        });

    } catch (error) {

        console.error(
            "Confirm delivery error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not confirm delivery."
        });

    }

});


// ========================================
// ERRANDS — CANCEL (student-initiated)
// Refunds any amounts already paid back
// to the student's wallet. Not allowed
// once the agent has marked "on the way"
// or later — too close to delivery to
// cleanly unwind.
// ========================================

app.post("/api/errands/:id/cancel", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId, reason } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const errandResult = await pool.query(
            `SELECT * FROM errands WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (errandResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Errand not found."
            });

        }

        const errand =
            errandResult.rows[0];

        if (String(errand.student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your errand."
            });

        }

        const uncancellableStatuses =
            ["on_way", "arrived", "completed", "cancelled", "failed"];

        if (uncancellableStatuses.includes(errand.status)) {

            return res.status(400).json({
                success: false,
                message: "This errand is too far along to cancel — try messaging your agent instead."
            });

        }

        let refundAmount = 0;

        if (errand.status !== "pending") {
            refundAmount += Number(errand.errand_fee);
        }

        if (errand.item_cost_status === "paid") {
            refundAmount += Number(errand.item_cost);
        }

        if (refundAmount > 0) {

            await pool.query(
                `UPDATE students SET wallet_balance = COALESCE(wallet_balance, 0) + $1 WHERE id = $2`,
                [refundAmount, studentId]
            );

        }

        const updated = await pool.query(
            `
            UPDATE errands
            SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP, cancellation_reason = $1
            WHERE id = $2
            RETURNING *
            `,
            [reason || "Cancelled by student", id]
        );

        res.status(200).json({
            success: true,
            errand: updated.rows[0],
            refunded: refundAmount
        });

    } catch (error) {

        console.error(
            "Cancel errand error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not cancel this errand."
        });

    }

});


// ========================================
// ERRANDS — AGENT CANCEL
// Returns the errand to the open pool for
// another agent, rather than killing it
// outright — and counts against the
// agent's reliability record.
// ========================================

app.post("/api/errands/:id/agent-cancel", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const errandResult = await pool.query(
            `SELECT * FROM errands WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (errandResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Errand not found."
            });

        }

        const errand =
            errandResult.rows[0];

        if (String(errand.agent_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "Only the assigned agent can back out of this errand."
            });

        }

        const uncancellableStatuses =
            ["on_way", "arrived", "completed", "cancelled", "failed"];

        if (uncancellableStatuses.includes(errand.status)) {

            return res.status(400).json({
                success: false,
                message: "This errand is too far along to back out of now."
            });

        }

        const newOtp =
            String(crypto.randomInt(1000, 9999));

        const updated = await pool.query(
            `
            UPDATE errands
            SET status = 'available', agent_id = NULL, accepted_at = NULL,
                started_at = NULL, picked_up_at = NULL, delivery_otp = $1
            WHERE id = $2
            RETURNING *
            `,
            [newOtp, id]
        );

        await pool.query(
            `
            UPDATE students
            SET errand_cancelled_count = COALESCE(errand_cancelled_count, 0) + 1
            WHERE id = $1
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            errand: updated.rows[0]
        });

    } catch (error) {

        console.error(
            "Agent cancel errand error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not back out of this errand."
        });

    }

});


// ========================================
// ERRANDS — RATE THE AGENT
// (only after completion, only once)
// ========================================

app.post("/api/errands/:id/rate", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId, rating, comment } = req.body;

        if (!studentId || !rating || Number(rating) < 1 || Number(rating) > 5) {

            return res.status(400).json({
                success: false,
                message: "Please give a rating between 1 and 5 stars."
            });

        }

        const errandResult = await pool.query(
            `SELECT * FROM errands WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (errandResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Errand not found."
            });

        }

        const errand =
            errandResult.rows[0];

        if (String(errand.student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your errand."
            });

        }

        if (errand.status !== "completed") {

            return res.status(400).json({
                success: false,
                message: "You can only rate a completed errand."
            });

        }

        if (errand.rating) {

            return res.status(400).json({
                success: false,
                message: "You've already rated this errand."
            });

        }

        await pool.query(
            `UPDATE errands SET rating = $1, rating_comment = $2 WHERE id = $3`,
            [Number(rating), comment || null, id]
        );

        await pool.query(
            `
            UPDATE students
            SET
                errand_rating_total = COALESCE(errand_rating_total, 0) + $1,
                errand_rating_count = COALESCE(errand_rating_count, 0) + 1
            WHERE id = $2
            `,
            [Number(rating), errand.agent_id]
        );

        res.status(200).json({
            success: true,
            message: "Thanks for rating your agent!"
        });

    } catch (error) {

        console.error(
            "Rate errand error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not submit your rating."
        });

    }

});


// ========================================
// PAY FOR AN ORDER DIRECTLY FROM WALLET
// BALANCE (instant, no external gateway)
// ========================================

app.post("/api/orders/pay/wallet", async (req, res) => {

    try {

        const { paymentReference, studentId } = req.body;

        if (!paymentReference || !studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing payment reference or studentId."
            });

        }

        const orderResult = await pool.query(
            `SELECT * FROM orders WHERE payment_reference = $1 LIMIT 1`,
            [paymentReference]
        );

        if (orderResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Order not found."
            });

        }

        const order = orderResult.rows[0];

        if (String(order.student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your order."
            });

        }

        if (order.status === "paid") {

            return res.status(200).json({
                success: true,
                message: "This order is already paid.",
                order: order
            });

        }

        const studentResult = await pool.query(
            `SELECT wallet_balance FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        const currentBalance =
            Number(studentResult.rows[0].wallet_balance || 0);

        if (currentBalance < Number(order.amount)) {

            return res.status(400).json({
                success: false,
                message: "Your wallet balance isn't enough to cover this order."
            });

        }

        // Deduct first, then mark paid — both guarded
        // inside a single flow so a repeated click can't
        // double-deduct (order.status check above already
        // protects against that on retry).

        await pool.query(
            `UPDATE students SET wallet_balance = wallet_balance - $1 WHERE id = $2`,
            [Number(order.amount), studentId]
        );

        await pool.query(
            `UPDATE orders SET payment_gateway = 'wallet' WHERE id = $1`,
            [order.id]
        );

        const result =
            await applyOrderPaymentResult(order, true, false, "wallet-" + order.payment_reference, "PAID");

        res.status(200).json(result);

    } catch (error) {

        console.error(
            "Pay order with wallet error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not complete this payment from your wallet."
        });

    }

});




app.get("/api/sellers/wallet", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const seller =
            await getApprovedSeller(studentId);

        if (!seller) {

            return res.status(403).json({
                success: false,
                message: "Only approved sellers have a wallet."
            });

        }

        const transactionsResult = await pool.query(
            `
            SELECT *
            FROM wallet_transactions
            WHERE seller_id = $1
            ORDER BY created_at DESC
            LIMIT 100
            `,
            [seller.id]
        );

        res.status(200).json({

            success: true,

            balance: Number(seller.wallet_balance || 0),

            transactions: transactionsResult.rows

        });

    } catch (error) {

        console.error(
            "Fetch seller wallet error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your wallet."
        });

    }

});


// ========================================
// REQUEST A PAYOUT
// (deducts from wallet_balance immediately,
// held in escrow until admin processes it —
// refunded automatically if rejected)
// ========================================

app.post("/api/sellers/payout/request", async (req, res) => {

    try {

        const { studentId, amount, bankName, bankAccountNumber, bankAccountName } = req.body;

        if (!studentId || !amount || isNaN(amount) || Number(amount) <= 0) {

            return res.status(400).json({
                success: false,
                message: "Please enter a valid amount to withdraw."
            });

        }

        if (!bankName || !bankAccountNumber || !bankAccountName) {

            return res.status(400).json({
                success: false,
                message: "Please provide your bank name, account number, and account name."
            });

        }

        const seller =
            await getApprovedSeller(studentId);

        if (!seller) {

            return res.status(403).json({
                success: false,
                message: "Only approved sellers can request a payout."
            });

        }

        const currentBalance =
            Number(seller.wallet_balance || 0);

        if (Number(amount) > currentBalance) {

            return res.status(400).json({
                success: false,
                message: "That's more than your available balance."
            });

        }

        // Deduct immediately (escrow) so the same balance
        // can't be requested twice while this is pending.

        await pool.query(
            `UPDATE sellers SET wallet_balance = wallet_balance - $1 WHERE id = $2`,
            [Number(amount), seller.id]
        );

        await pool.query(
            `
            UPDATE sellers
            SET bank_name = $1, bank_account_number = $2, bank_account_name = $3
            WHERE id = $4
            `,
            [bankName, bankAccountNumber, bankAccountName, seller.id]
        );

        const result = await pool.query(
            `
            INSERT INTO payout_requests (
                seller_id, amount, bank_name, bank_account_number, bank_account_name, status
            )
            VALUES ($1, $2, $3, $4, $5, 'pending')
            RETURNING *
            `,
            [seller.id, Number(amount), bankName, bankAccountNumber, bankAccountName]
        );

        await pool.query(
            `
            INSERT INTO wallet_transactions (seller_id, type, amount, description)
            VALUES ($1, 'payout_requested', $2, 'Payout requested — pending review')
            `,
            [seller.id, -Number(amount)]
        );

        res.status(201).json({
            success: true,
            payout: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Request payout error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not submit your payout request."
        });

    }

});


// ========================================
// SELLER'S OWN PAYOUT HISTORY
// ========================================

app.get("/api/sellers/payouts", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const seller =
            await getApprovedSeller(studentId);

        if (!seller) {

            return res.status(403).json({
                success: false,
                message: "Only approved sellers have payout history."
            });

        }

        const result = await pool.query(
            `
            SELECT *
            FROM payout_requests
            WHERE seller_id = $1
            ORDER BY requested_at DESC
            `,
            [seller.id]
        );

        res.status(200).json({
            success: true,
            payouts: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch seller payouts error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your payout history."
        });

    }

});


// ========================================
// SELLER DASHBOARD STATS
// (real numbers only — sales totals, order
// counts, top products, a 7-day sales trend,
// and order status breakdown, all computed
// from actual paid orders. No fabricated
// metrics like "conversion rate" or "store
// rating" — we don't track those.)
// ========================================

app.get("/api/sellers/dashboard-stats", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const seller =
            await getApprovedSeller(studentId);

        if (!seller) {

            return res.status(403).json({
                success: false,
                message: "Only approved sellers can view dashboard stats."
            });

        }


        // ====================================
        // PRODUCT COUNT
        // ====================================

        const productsResult = await pool.query(
            `SELECT id, name, price, image_url FROM products WHERE seller_id = $1`,
            [seller.id]
        );

        const sellerProducts = productsResult.rows;

        const productNameById = {};

        sellerProducts.forEach(function (p) {
            productNameById[p.id] = p.name;
        });

        const sellerProductIds =
            new Set(sellerProducts.map(function (p) { return p.id; }));


        // ====================================
        // ALL ORDERS TOUCHING THIS SELLER
        // (any status, so we can show a real
        // status breakdown too)
        // ====================================

        let sellerTouches = [];

        if (sellerProductIds.size > 0) {

            const ordersResult = await pool.query(
                `
                SELECT
                    orders.id,
                    orders.status,
                    orders.items,
                    orders.created_at,
                    orders.student_id,
                    students.first_name,
                    students.last_name
                FROM orders
                JOIN students ON students.id = orders.student_id
                ORDER BY orders.created_at DESC
                LIMIT 500
                `
            );

            ordersResult.rows.forEach(function (order) {

                let items = [];

                try {

                    items =
                        typeof order.items === "string" ?
                            JSON.parse(order.items) :
                            order.items;

                } catch (error) {

                    items = [];

                }

                const myItems =
                    items.filter(function (item) {
                        return sellerProductIds.has(item.id);
                    });

                if (myItems.length === 0) {
                    return;
                }

                const subtotal =
                    myItems.reduce(function (sum, item) {
                        return sum + (Number(item.price) * item.quantity);
                    }, 0);

                sellerTouches.push({
                    orderId: order.id,
                    status: order.status,
                    items: myItems,
                    subtotal: subtotal,
                    createdAt: order.created_at,
                    buyerName:
                        `${order.first_name || ""} ${order.last_name || ""}`.trim() ||
                        "Kurios Student"
                });

            });

        }

        const paidTouches =
            sellerTouches.filter(function (t) { return t.status === "paid"; });


        // ====================================
        // TOTAL SALES + UNIQUE CUSTOMERS
        // ====================================

        const totalSales =
            paidTouches.reduce(function (sum, t) { return sum + t.subtotal; }, 0);

        const uniqueCustomers =
            new Set(
                paidTouches.map(function (t) { return t.buyerName; })
            ).size;


        // ====================================
        // STORE RATING (real, from reviews on
        // this seller's own products — 0 if none)
        // ====================================

        let storeRating = 0;
        let storeReviewCount = 0;

        if (sellerProductIds.size > 0) {

            const ratingResult = await pool.query(
                `
                SELECT rating
                FROM reviews
                WHERE product_id = ANY($1::int[])
                `,
                [Array.from(sellerProductIds)]
            );

            storeReviewCount = ratingResult.rows.length;

            if (storeReviewCount > 0) {

                storeRating =
                    Math.round(
                        (ratingResult.rows.reduce(function (sum, r) { return sum + r.rating; }, 0) /
                            storeReviewCount) * 10
                    ) / 10;

            }

        }


        // ====================================
        // SALES BY DAY (LAST 7 DAYS)
        // ====================================

        const salesByDay = [];

        for (let i = 6; i >= 0; i--) {

            const day = new Date();
            day.setDate(day.getDate() - i);
            day.setHours(0, 0, 0, 0);

            const nextDay = new Date(day);
            nextDay.setDate(nextDay.getDate() + 1);

            const dayTotal =
                paidTouches
                    .filter(function (t) {

                        const created = new Date(t.createdAt);
                        return created >= day && created < nextDay;

                    })
                    .reduce(function (sum, t) { return sum + t.subtotal; }, 0);

            salesByDay.push({

                label: day.toLocaleDateString(undefined, { month: "short", day: "numeric" }),

                total: dayTotal

            });

        }


        // ====================================
        // TOP SELLING PRODUCTS
        // ====================================

        const qtyByProduct = {};

        paidTouches.forEach(function (t) {

            t.items.forEach(function (item) {

                qtyByProduct[item.id] =
                    (qtyByProduct[item.id] || 0) + Number(item.quantity);

            });

        });

        const topProducts =
            Object.keys(qtyByProduct)
                .map(function (productId) {

                    const product =
                        sellerProducts.find(function (p) {
                            return String(p.id) === String(productId);
                        });

                    return {
                        id: productId,
                        name: product ? product.name : "Product",
                        price: product ? Number(product.price || 0) : 0,
                        image_url: product ? product.image_url : null,
                        quantitySold: qtyByProduct[productId]
                    };

                })
                .sort(function (a, b) {
                    return b.quantitySold - a.quantitySold;
                })
                .slice(0, 5);


        // ====================================
        // ORDER STATUS BREAKDOWN
        // ====================================

        const statusBreakdown = {
            paid: 0,
            pending: 0,
            failed: 0
        };

        sellerTouches.forEach(function (t) {

            if (statusBreakdown[t.status] !== undefined) {
                statusBreakdown[t.status]++;
            }

        });


        // ====================================
        // RECENT ORDERS (LAST 5)
        // ====================================

        const recentOrders =
            sellerTouches.slice(0, 5);


        res.status(200).json({

            success: true,

            totalSales: totalSales,

            orderCount: paidTouches.length,

            productCount: sellerProducts.length,

            uniqueCustomers: uniqueCustomers,

            walletBalance: Number(seller.wallet_balance || 0),

            storeRating: storeRating,

            storeReviewCount: storeReviewCount,

            salesByDay: salesByDay,

            topProducts: topProducts,

            statusBreakdown: statusBreakdown,

            recentOrders: recentOrders

        });

    } catch (error) {

        console.error(
            "Seller dashboard stats error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your dashboard."
        });

    }

});


// ========================================
// UPLOAD YOUR OWN STORE LOGO
// (approved sellers only)
// ========================================

app.post(
    "/api/sellers/logo",
    function (req, res, next) {

        productImageUpload.single("logo")(
            req,
            res,
            function (error) {

                if (error) {

                    return res.status(400).json({
                        success: false,
                        message: error.message
                    });

                }

                next();

            }
        );

    },
    async (req, res) => {

        try {

            const { studentId } = req.body;

            if (!studentId) {

                return res.status(400).json({
                    success: false,
                    message: "Missing studentId."
                });

            }

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    message: "Please choose a logo image."
                });

            }

            const seller =
                await getApprovedSeller(studentId);

            if (!seller) {

                return res.status(403).json({
                    success: false,
                    message: "Only approved sellers can upload a store logo."
                });

            }

            const newImageUrl =
                "/uploads/" + req.file.filename;

            const updatedResult = await pool.query(
                `
                UPDATE sellers
                SET store_image = $1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                RETURNING *
                `,
                [newImageUrl, seller.id]
            );

            if (seller.store_image) {

                const oldImagePath =
                    path.join(
                        uploadsFolder,
                        path.basename(seller.store_image)
                    );

                fs.unlink(oldImagePath, function () {});

            }

            res.status(200).json({
                success: true,
                message: "Store logo updated.",
                seller: updatedResult.rows[0]
            });

        } catch (error) {

            console.error(
                "Seller logo upload error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Could not update your store logo."
            });

        }

    }
);


// ========================================
// ADMIN — UPDATE ANY SELLER'S LOGO
// (also how Kurios Stores' own logo is set,
// since it has no student account behind it)
// ========================================

app.post(
    "/api/admin/sellers/:id/logo",
    requireAdminAuth,
    function (req, res, next) {

        productImageUpload.single("logo")(
            req,
            res,
            function (error) {

                if (error) {

                    return res.status(400).json({
                        success: false,
                        message: error.message
                    });

                }

                next();

            }
        );

    },
    async (req, res) => {

        try {

            const { id } = req.params;

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    message: "Please choose a logo image."
                });

            }

            const currentResult = await pool.query(
                `SELECT * FROM sellers WHERE id = $1 LIMIT 1`,
                [id]
            );

            if (currentResult.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "Seller not found."
                });

            }

            const currentSeller =
                currentResult.rows[0];

            const newImageUrl =
                "/uploads/" + req.file.filename;

            const updatedResult = await pool.query(
                `
                UPDATE sellers
                SET store_image = $1, updated_at = CURRENT_TIMESTAMP
                WHERE id = $2
                RETURNING *
                `,
                [newImageUrl, id]
            );

            if (currentSeller.store_image) {

                const oldImagePath =
                    path.join(
                        uploadsFolder,
                        path.basename(currentSeller.store_image)
                    );

                fs.unlink(oldImagePath, function () {});

            }

            res.status(200).json({
                success: true,
                message: "Store logo updated.",
                seller: updatedResult.rows[0]
            });

        } catch (error) {

            console.error(
                "Admin seller logo upload error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Could not update this store's logo."
            });

        }

    }
);


// ========================================
// GET THE KURIOS STORES SELLER RECORD
// (so the admin page knows its ID)
// ========================================

app.get(
    "/api/admin/kurios-store",
    requireAdminAuth,
    async (req, res) => {

        try {

            const result = await pool.query(
                `
                SELECT
                    sellers.*,
                    students.first_name AS linked_first_name,
                    students.last_name AS linked_last_name,
                    students.email AS linked_email
                FROM sellers
                LEFT JOIN students ON students.id = sellers.student_id
                WHERE sellers.is_official = true
                LIMIT 1
                `
            );

            if (result.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "Kurios Stores seller record not found."
                });

            }

            res.status(200).json({
                success: true,
                seller: result.rows[0]
            });

        } catch (error) {

            console.error(
                "Fetch Kurios Stores seller error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Could not load Kurios Stores seller record."
            });

        }

    }
);


// ========================================
// LINK KURIOS STORES TO A STUDENT ACCOUNT
// (so that student can manage it through
// the normal seller dashboard, instead of
// only through this admin page)
// ========================================

app.post(
    "/api/admin/kurios-store/link",
    requireAdminAuth,
    async (req, res) => {

        try {

            const { identifier } = req.body;

            if (!identifier) {

                return res.status(400).json({
                    success: false,
                    message: "Please provide the student's email."
                });

            }

            const studentResult = await pool.query(
                `
                SELECT id, first_name, last_name, email
                FROM students
                WHERE LOWER(email) = LOWER($1)
                LIMIT 1
                `,
                [identifier.trim()]
            );

            if (studentResult.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "No student account found with that email."
                });

            }

            const student =
                studentResult.rows[0];

            const kuriosResult = await pool.query(
                `
                UPDATE sellers
                SET student_id = $1, updated_at = CURRENT_TIMESTAMP
                WHERE is_official = true
                RETURNING *
                `,
                [student.id]
            );

            if (kuriosResult.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "Kurios Stores seller record not found."
                });

            }

            res.status(200).json({

                success: true,

                message:
                    "Kurios Stores is now linked to " +
                    (student.first_name || student.email) +
                    ". They can manage it from their own seller dashboard.",

                seller: kuriosResult.rows[0]

            });

        } catch (error) {

            console.error(
                "Link Kurios Stores error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Could not link Kurios Stores to that account."
            });

        }

    }
);


// ========================================
// PARSE A CSV FILE INTO ROW OBJECTS
// (handles quoted fields, commas inside
// quotes, and "" as an escaped quote)
// ========================================

function parseCsv(text) {

    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;

    // Normalise line endings first.

    const cleanText =
        text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

    for (let i = 0; i < cleanText.length; i++) {

        const char = cleanText[i];

        if (inQuotes) {

            if (char === '"') {

                if (cleanText[i + 1] === '"') {
                    field += '"';
                    i++;
                } else {
                    inQuotes = false;
                }

            } else {

                field += char;

            }

        } else {

            if (char === '"') {

                inQuotes = true;

            } else if (char === ",") {

                row.push(field);
                field = "";

            } else if (char === "\n") {

                row.push(field);
                rows.push(row);
                row = [];
                field = "";

            } else {

                field += char;

            }

        }

    }

    // Last field/row, if the file doesn't
    // end with a newline.

    if (field.length > 0 || row.length > 0) {
        row.push(field);
        rows.push(row);
    }

    if (rows.length === 0) {
        return [];
    }

    const headers =
        rows[0].map(function (h) {
            return h.trim();
        });

    const dataRows =
        rows.slice(1).filter(function (r) {
            return r.some(function (cell) {
                return cell.trim() !== "";
            });
        });

    return dataRows.map(function (cells) {

        const obj = {};

        headers.forEach(function (header, index) {
            obj[header] = (cells[index] || "").trim();
        });

        return obj;

    });

}


// ========================================
// IMPORT PRODUCTS FROM A CSV FILE
// (approved sellers only — works with plain
// spreadsheets, and with multi-location POS
// exports like Loyverse's, where you pick
// which location's price/stock columns to use)
// ========================================

app.post(
    "/api/sellers/products/import",
    function (req, res, next) {

        csvUpload.single("file")(
            req,
            res,
            function (error) {

                if (error) {

                    return res.status(400).json({
                        success: false,
                        message: error.message
                    });

                }

                next();

            }
        );

    },
    async (req, res) => {

        try {

            const { studentId, location } = req.body;

            if (!studentId) {

                return res.status(400).json({
                    success: false,
                    message: "Missing studentId."
                });

            }

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    message: "Please choose a CSV file."
                });

            }

            const seller =
                await getApprovedSeller(studentId);

            if (!seller) {

                return res.status(403).json({
                    success: false,
                    message: "Only approved sellers can import products."
                });

            }

            const csvText =
                req.file.buffer.toString("utf-8");

            const rows =
                parseCsv(csvText);

            if (rows.length === 0) {

                return res.status(400).json({
                    success: false,
                    message: "That CSV file appears to be empty."
                });

            }


            // ====================================
            // WORK OUT WHICH COLUMNS TO READ FROM,
            // BASED ON THE CHOSEN LOCATION (IF ANY)
            // ====================================

            const suffix =
                location ? " [" + location + "]" : "";

            const nameKey = "Item Name";
            const skuKey = "SKU";
            const categoryKey = "Category";
            const variationKey = "Variation Name";

            const priceKey =
                location ?
                    "Fixed Sell Price" + suffix :
                    "Fixed Sell Price";

            const stockKey =
                location ?
                    "Stock" + suffix :
                    "Stock";

            const availableKey =
                location ?
                    "Available" + suffix :
                    null;

            let imported = 0;
            let updated = 0;
            let skipped = 0;

            for (const row of rows) {

                const itemName =
                    (row[nameKey] || "").trim();

                if (!itemName) {
                    skipped++;
                    continue;
                }


                // Skip rows explicitly marked as
                // unavailable at the chosen location.

                if (
                    availableKey &&
                    row[availableKey] &&
                    row[availableKey].trim().toUpperCase() === "N"
                ) {
                    skipped++;
                    continue;
                }


                // Price: prefer the location-specific
                // column, fall back to the plain one.

                let rawPrice =
                    row[priceKey];

                if (
                    (!rawPrice || !rawPrice.trim()) &&
                    location
                ) {
                    rawPrice = row["Fixed Sell Price"];
                }

                const price =
                    parseFloat(
                        (rawPrice || "").replace(/,/g, "")
                    );

                if (!price || price <= 0 || isNaN(price)) {
                    skipped++;
                    continue;
                }


                // Stock — defaults to 0 if not found.

                const rawStock =
                    row[stockKey];

                const stock =
                    rawStock && rawStock.trim() ?
                        Math.max(0, Math.floor(parseFloat(rawStock))) :
                        0;


                // Category, SKU.

                const category =
                    (row[categoryKey] || "").trim() || null;

                const sku =
                    (row[skuKey] || "").trim() || null;


                // Fold a meaningful variation name into
                // the product name (skip generic "Regular"
                // or a variation identical to the item name).

                const variation =
                    (row[variationKey] || "").trim();

                const finalName =
                    (
                        variation &&
                        variation.toLowerCase() !== "regular" &&
                        variation.toLowerCase() !== itemName.toLowerCase()
                    ) ?
                        itemName + " (" + variation + ")" :
                        itemName;


                // ====================================
                // UPSERT — MATCH BY SKU FIRST, THEN
                // BY EXACT NAME WITHIN THIS SELLER
                // ====================================

                let existing = null;

                if (sku) {

                    const existingBySku = await pool.query(
                        `
                        SELECT id
                        FROM products
                        WHERE seller_id = $1
                        AND sku = $2
                        LIMIT 1
                        `,
                        [seller.id, sku]
                    );

                    existing = existingBySku.rows[0] || null;

                }

                if (!existing) {

                    const existingByName = await pool.query(
                        `
                        SELECT id
                        FROM products
                        WHERE seller_id = $1
                        AND LOWER(name) = LOWER($2)
                        LIMIT 1
                        `,
                        [seller.id, finalName]
                    );

                    existing = existingByName.rows[0] || null;

                }

                if (existing) {

                    await pool.query(
                        `
                        UPDATE products
                        SET
                            name = $1,
                            category = $2,
                            price = $3,
                            stock_quantity = $4,
                            sku = $5,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = $6
                        `,
                        [
                            finalName,
                            category,
                            price,
                            stock,
                            sku,
                            existing.id
                        ]
                    );

                    updated++;

                } else {

                    await pool.query(
                        `
                        INSERT INTO products (
                            name,
                            category,
                            price,
                            stock_quantity,
                            sku,
                            seller_id
                        )
                        VALUES ($1, $2, $3, $4, $5, $6)
                        `,
                        [
                            finalName,
                            category,
                            price,
                            stock,
                            sku,
                            seller.id
                        ]
                    );

                    imported++;

                }

            }

            res.status(200).json({

                success: true,

                message:
                    "Import complete: " +
                    imported + " added, " +
                    updated + " updated, " +
                    skipped + " skipped.",

                imported: imported,

                updated: updated,

                skipped: skipped

            });

        } catch (error) {

            console.error(
                "CSV import error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Something went wrong while importing your products."
            });

        }

    }
);


// ========================================
// ADD A PRODUCT (APPROVED SELLERS ONLY)
// ========================================

app.post(
    "/api/sellers/products",
    function (req, res, next) {

        productImageUpload.single("image")(
            req,
            res,
            function (error) {

                if (error) {

                    return res.status(400).json({
                        success: false,
                        message: error.message
                    });

                }

                next();

            }
        );

    },
    async (req, res) => {

        try {

            const {
                studentId,
                name,
                description,
                price,
                category,
                stockQuantity,
                discountPrice,
                discountStartsAt,
                discountEndsAt
            } = req.body;

            if (!studentId || !name || !price) {

                return res.status(400).json({
                    success: false,
                    message: "Please provide at least a product name and price."
                });

            }

            const seller =
                await getApprovedSeller(studentId);

            if (!seller) {

                return res.status(403).json({
                    success: false,
                    message: "Only approved sellers can add products."
                });

            }

            const imageUrl =
                req.file ?
                    "/uploads/" + req.file.filename :
                    null;

            const result = await pool.query(
                `
                INSERT INTO products (
                    name,
                    description,
                    price,
                    image_url,
                    category,
                    stock_quantity,
                    seller_id,
                    discount_price,
                    discount_starts_at,
                    discount_ends_at
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                RETURNING *
                `,
                [
                    name.trim(),
                    description ? description.trim() : null,
                    price,
                    imageUrl,
                    category ? category.trim() : null,
                    stockQuantity ? parseInt(stockQuantity, 10) : 0,
                    seller.id,
                    discountPrice ? Number(discountPrice) : null,
                    discountStartsAt || null,
                    discountEndsAt || null
                ]
            );

            res.status(201).json({
                success: true,
                message: "Product added.",
                product: result.rows[0]
            });

        } catch (error) {

            console.error(
                "Add product error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Something went wrong while adding your product."
            });

        }

    }
);


// ========================================
// LIST A SELLER'S OWN PRODUCTS
// ========================================

app.get("/api/sellers/products", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const seller =
            await getApprovedSeller(studentId);

        if (!seller) {

            return res.status(403).json({
                success: false,
                message: "Only approved sellers can view their products."
            });

        }

        const result = await pool.query(
            `
            SELECT *
            FROM products
            WHERE seller_id = $1
            ORDER BY created_at DESC
            `,
            [seller.id]
        );

        res.status(200).json({
            success: true,
            products: result.rows
        });

    } catch (error) {

        console.error(
            "List seller products error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your products."
        });

    }

});


// ========================================
// EDIT A PRODUCT (OWNER ONLY)
// ========================================

app.post(
    "/api/sellers/products/:id/update",
    function (req, res, next) {

        productImageUpload.single("image")(
            req,
            res,
            function (error) {

                if (error) {

                    return res.status(400).json({
                        success: false,
                        message: error.message
                    });

                }

                next();

            }
        );

    },
    async (req, res) => {

        try {

            const { id } = req.params;

            const {
                studentId,
                name,
                description,
                price,
                category,
                stockQuantity,
                isActive,
                discountPrice,
                discountStartsAt,
                discountEndsAt
            } = req.body;

            if (!studentId) {

                return res.status(400).json({
                    success: false,
                    message: "Missing studentId."
                });

            }

            const seller =
                await getApprovedSeller(studentId);

            if (!seller) {

                return res.status(403).json({
                    success: false,
                    message: "Only approved sellers can edit products."
                });

            }

            const currentResult = await pool.query(
                `SELECT * FROM products WHERE id = $1 LIMIT 1`,
                [id]
            );

            if (currentResult.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "Product not found."
                });

            }

            const currentProduct =
                currentResult.rows[0];

            if (currentProduct.seller_id !== seller.id) {

                return res.status(403).json({
                    success: false,
                    message: "You don't own this product."
                });

            }

            const newImageUrl =
                req.file ?
                    "/uploads/" + req.file.filename :
                    currentProduct.image_url;

            const updatedResult = await pool.query(
                `
                UPDATE products
                SET
                    name = $1,
                    description = $2,
                    price = $3,
                    category = $4,
                    stock_quantity = $5,
                    image_url = $6,
                    is_active = $7,
                    discount_price = $8,
                    discount_starts_at = $9,
                    discount_ends_at = $10,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $11
                RETURNING *
                `,
                [
                    name ? name.trim() : currentProduct.name,
                    description !== undefined ?
                        (description ? description.trim() : null) :
                        currentProduct.description,
                    price ? price : currentProduct.price,
                    category !== undefined ?
                        (category ? category.trim() : null) :
                        currentProduct.category,
                    stockQuantity !== undefined ?
                        parseInt(stockQuantity, 10) :
                        currentProduct.stock_quantity,
                    newImageUrl,
                    isActive !== undefined ?
                        (isActive === "true" || isActive === true) :
                        currentProduct.is_active,
                    discountPrice !== undefined ?
                        (discountPrice === "" || discountPrice === null ? null : Number(discountPrice)) :
                        currentProduct.discount_price,
                    discountStartsAt !== undefined ?
                        (discountStartsAt || null) :
                        currentProduct.discount_starts_at,
                    discountEndsAt !== undefined ?
                        (discountEndsAt || null) :
                        currentProduct.discount_ends_at,
                    id
                ]
            );


            // Remove the old image file only once the
            // new one is safely saved.

            if (
                req.file &&
                currentProduct.image_url &&
                currentProduct.image_url !== newImageUrl
            ) {

                const oldImagePath =
                    path.join(
                        uploadsFolder,
                        path.basename(currentProduct.image_url)
                    );

                fs.unlink(oldImagePath, function () {});

            }

            res.status(200).json({
                success: true,
                message: "Product updated.",
                product: updatedResult.rows[0]
            });

        } catch (error) {

            console.error(
                "Update product error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Something went wrong while updating your product."
            });

        }

    }
);


// ========================================
// DELETE A PRODUCT (OWNER ONLY)
// ========================================

app.post("/api/sellers/products/:id/delete", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const seller =
            await getApprovedSeller(studentId);

        if (!seller) {

            return res.status(403).json({
                success: false,
                message: "Only approved sellers can delete products."
            });

        }

        const currentResult = await pool.query(
            `SELECT * FROM products WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (currentResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Product not found."
            });

        }

        const product =
            currentResult.rows[0];

        if (product.seller_id !== seller.id) {

            return res.status(403).json({
                success: false,
                message: "You don't own this product."
            });

        }

        await pool.query(
            `DELETE FROM products WHERE id = $1`,
            [id]
        );

        if (product.image_url) {

            const imagePath =
                path.join(
                    uploadsFolder,
                    path.basename(product.image_url)
                );

            fs.unlink(imagePath, function () {});

        }

        res.status(200).json({
            success: true,
            message: "Product deleted."
        });

    } catch (error) {

        console.error(
            "Delete product error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not delete this product."
        });

    }

});


// ========================================
// PUBLIC STOREFRONT
// ========================================

app.get("/api/store/:sellerId", async (req, res) => {

    try {

        const { sellerId } = req.params;

        const sellerResult = await pool.query(
            `
            SELECT
                id,
                store_name,
                store_description,
                business_category,
                location,
                seller_type,
                store_image
            FROM sellers
            WHERE id = $1
            AND status = 'approved'
            LIMIT 1
            `,
            [sellerId]
        );

        if (sellerResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Store not found."
            });

        }

        const productsResult = await pool.query(
            `
            SELECT
                products.*,
                COALESCE(review_stats.avg_rating, 0) AS avg_rating,
                COALESCE(review_stats.review_count, 0) AS review_count
            FROM products
            LEFT JOIN (
                SELECT
                    product_id,
                    ROUND(AVG(rating)::numeric, 1) AS avg_rating,
                    COUNT(*) AS review_count
                FROM reviews
                GROUP BY product_id
            ) AS review_stats ON review_stats.product_id = products.id
            WHERE products.seller_id = $1
            AND products.is_active = true
            ORDER BY products.created_at DESC
            `,
            [sellerId]
        );

        res.status(200).json({
            success: true,
            store: sellerResult.rows[0],
            products: productsResult.rows
        });

    } catch (error) {

        console.error(
            "Fetch storefront error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load this store."
        });

    }

});


// ========================================
// ADMIN — DEACTIVATE / REACTIVATE A PRODUCT
// ========================================

async function setProductActive(req, res, isActive) {

    try {

        const { id } = req.params;

        const result = await pool.query(
            `
            UPDATE products
            SET is_active = $1, updated_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
            `,
            [isActive, id]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Product not found."
            });

        }

        res.status(200).json({
            success: true,
            message: isActive ? "Product reactivated." : "Product deactivated.",
            product: result.rows[0]
        });

    } catch (error) {

        console.error(
            "Admin product moderation error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not update this product."
        });

    }

}

app.post(
    "/api/admin/products/:id/deactivate",
    requireAdminAuth,
    (req, res) => setProductActive(req, res, false)
);

app.post(
    "/api/admin/products/:id/activate",
    requireAdminAuth,
    (req, res) => setProductActive(req, res, true)
);


// ========================================
// CHAT — FIND A STUDENT BY PHONE NUMBER
// ========================================

app.post("/api/chat/find", async (req, res) => {

    try {

        const { studentId, phoneNumber } = req.body;

        if (!studentId || !phoneNumber) {

            return res.status(400).json({
                success: false,
                message: "Please enter a phone number."
            });

        }

        const result = await pool.query(
            `
            SELECT id, first_name, last_name, profile_picture, university, phone, whatsapp_number
            FROM students
            WHERE
                RIGHT(regexp_replace(phone, '\\D', '', 'g'), 10) =
                RIGHT(regexp_replace($1, '\\D', '', 'g'), 10)
            AND id != $2
            LIMIT 1
            `,
            [phoneNumber, studentId]
        );

        if (result.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "No Kurios Stores student found with that phone number."
            });

        }

        const foundStudent =
            result.rows[0];

        const conversationId =
            await findOrCreateConversation(studentId, foundStudent.id, "NORMAL", null);

        res.status(200).json({
            success: true,
            student: foundStudent,
            conversationId: conversationId
        });

    } catch (error) {

        console.error(
            "Chat find student error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not look up that phone number."
        });

    }

});


// ========================================
// SEARCH FOR STUDENTS BY NAME
// (returns multiple matches, unlike the
// phone lookup above which is exact/unique)
// ========================================

app.get("/api/chat/search-students", async (req, res) => {

    try {

        const { studentId, query } = req.query;

        if (!studentId || !query || query.trim().length < 2) {

            return res.status(200).json({
                success: true,
                students: []
            });

        }

        const result = await pool.query(
            `
            SELECT id, first_name, last_name, profile_picture, university
            FROM students
            WHERE
                (first_name ILIKE $1 OR last_name ILIKE $1 OR (first_name || ' ' || last_name) ILIKE $1)
                AND id != $2
                AND is_support = false
            ORDER BY first_name ASC
            LIMIT 10
            `,
            ["%" + query.trim() + "%", studentId]
        );

        res.status(200).json({
            success: true,
            students: result.rows
        });

    } catch (error) {

        console.error(
            "Search students error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not search for students."
        });

    }

});


// ========================================
// CHAT — LIST MY CONVERSATIONS
// ========================================

app.get("/api/chat/conversations", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const result = await pool.query(
            `
            SELECT
                conversations.id AS conversation_id,
                conversations.type,
                conversations.context_id,
                partner.id,
                CASE
                    WHEN conversations.type = 'SUPPORT'
                    AND conversations.claimed_by IS DISTINCT FROM $1
                    THEN 'Elkurios'
                    ELSE partner.first_name
                END AS first_name,
                CASE
                    WHEN conversations.type = 'SUPPORT'
                    AND conversations.claimed_by IS DISTINCT FROM $1
                    THEN ''
                    ELSE partner.last_name
                END AS last_name,
                CASE
                    WHEN conversations.type = 'SUPPORT'
                    AND conversations.claimed_by IS DISTINCT FROM $1
                    THEN NULL
                    ELSE partner.profile_picture
                END AS profile_picture,
                partner.university,
                CASE
                    WHEN conversations.type = 'SUPPORT'
                    AND conversations.claimed_by IS DISTINCT FROM $1
                    THEN NULL
                    ELSE partner.phone
                END AS phone,
                CASE
                    WHEN conversations.type = 'SUPPORT'
                    AND conversations.claimed_by IS DISTINCT FROM $1
                    THEN NULL
                    ELSE partner.whatsapp_number
                END AS whatsapp_number,
                partner_seller.store_name AS partner_store_name,
                product.name AS product_name,
                latest.body AS last_message,
                latest.created_at AS last_message_at,
                latest.sender_id AS last_message_sender_id,
                (
                    SELECT COUNT(*)::int
                    FROM messages
                    WHERE conversation_id = conversations.id
                    AND recipient_id = $1
                    AND read_at IS NULL
                ) AS unread_count
            FROM conversation_participants my_cp
            JOIN conversations ON conversations.id = my_cp.conversation_id
            JOIN conversation_participants other_cp
                ON other_cp.conversation_id = conversations.id
                AND other_cp.student_id != $1
            JOIN students AS partner ON partner.id = other_cp.student_id
            JOIN LATERAL (
                SELECT body, created_at, sender_id
                FROM messages
                WHERE conversation_id = conversations.id
                ORDER BY created_at DESC
                LIMIT 1
            ) AS latest ON true
            LEFT JOIN products AS product
                ON product.id = conversations.context_id
                AND conversations.type = 'PRODUCT'
            LEFT JOIN sellers AS partner_seller
                ON partner_seller.student_id = partner.id
                AND partner_seller.status = 'approved'
                AND conversations.type != 'SUPPORT'
            WHERE my_cp.student_id = $1
            AND NOT (
                conversations.type = 'SUPPORT'
                AND EXISTS (SELECT 1 FROM students WHERE id = $1 AND is_support = true)
            )
            ORDER BY latest.created_at DESC
            `,
            [studentId]
        );

        res.status(200).json({
            success: true,
            conversations: result.rows
        });

    } catch (error) {

        console.error(
            "List conversations error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load your conversations."
        });

    }

});


// ========================================
// CHAT — GET A MESSAGE THREAD
// (also marks incoming messages as read)
// ========================================

app.get("/api/chat/messages", async (req, res) => {

    try {

        const { studentId, withId, conversationId } = req.query;

        if (!studentId || !withId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId or withId."
            });

        }

        let result;

        if (conversationId) {

            // Confirm this student is actually a participant
            // before showing anything from this conversation.

            const membershipCheck = await pool.query(
                `
                SELECT 1
                FROM conversation_participants
                WHERE conversation_id = $1
                AND student_id = $2
                LIMIT 1
                `,
                [conversationId, studentId]
            );

            if (membershipCheck.rows.length === 0) {

                return res.status(403).json({
                    success: false,
                    message: "You don't have access to this conversation."
                });

            }

            result = await pool.query(
                `
                SELECT *
                FROM messages
                WHERE conversation_id = $1
                ORDER BY created_at ASC
                `,
                [conversationId]
            );

        } else {

            result = await pool.query(
                `
                SELECT *
                FROM messages
                WHERE
                    (sender_id = $1 AND recipient_id = $2)
                    OR (sender_id = $2 AND recipient_id = $1)
                ORDER BY created_at ASC
                `,
                [studentId, withId]
            );

        }

        await pool.query(
            `
            UPDATE messages
            SET read_at = CURRENT_TIMESTAMP
            WHERE recipient_id = $1
            AND sender_id = $2
            AND read_at IS NULL
            `,
            [studentId, withId]
        );

        const messageIds =
            result.rows.map(function (m) { return m.id; });

        let reactionsByMessage = {};

        if (messageIds.length > 0) {

            const reactionsResult = await pool.query(
                `
                SELECT message_id, emoji, student_id
                FROM message_reactions
                WHERE message_id = ANY($1)
                `,
                [messageIds]
            );

            reactionsResult.rows.forEach(function (r) {

                if (!reactionsByMessage[r.message_id]) {
                    reactionsByMessage[r.message_id] = {};
                }

                if (!reactionsByMessage[r.message_id][r.emoji]) {
                    reactionsByMessage[r.message_id][r.emoji] = { emoji: r.emoji, count: 0, reactedByMe: false };
                }

                reactionsByMessage[r.message_id][r.emoji].count += 1;

                if (String(r.student_id) === String(studentId)) {
                    reactionsByMessage[r.message_id][r.emoji].reactedByMe = true;
                }

            });

        }

        const messagesWithReactions =
            result.rows.map(function (m) {

                return Object.assign({}, m, {
                    reactions: reactionsByMessage[m.id] ? Object.values(reactionsByMessage[m.id]) : []
                });

            });

        res.status(200).json({
            success: true,
            messages: messagesWithReactions
        });

    } catch (error) {

        console.error(
            "Fetch message thread error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load this conversation."
        });

    }

});


// ========================================
// FIND OR CREATE A NORMAL CONVERSATION
// BETWEEN TWO STUDENTS
// ========================================

async function findOrCreateNormalConversation(studentA, studentB) {

    return await findOrCreateConversation(studentA, studentB, "NORMAL", null);

}


// ========================================
// FIND OR CREATE ANY CONVERSATION
// (normal, or tied to a product/order/etc —
// same two people can have a NORMAL chat
// AND a separate PRODUCT chat about a
// specific item, without them mixing)
// ========================================

async function findOrCreateConversation(studentA, studentB, type, contextId) {

    const existing = await pool.query(
        `
        SELECT cp1.conversation_id
        FROM conversation_participants cp1
        JOIN conversation_participants cp2
            ON cp1.conversation_id = cp2.conversation_id
        JOIN conversations c ON c.id = cp1.conversation_id
        WHERE cp1.student_id = $1
        AND cp2.student_id = $2
        AND c.type = $3
        AND (
            ($4::int IS NULL AND c.context_id IS NULL)
            OR c.context_id = $4
        )
        ORDER BY c.id ASC
        LIMIT 1
        `,
        [studentA, studentB, type, contextId]
    );

    if (existing.rows.length > 0) {
        return existing.rows[0].conversation_id;
    }

    const created = await pool.query(
        `INSERT INTO conversations (type, context_id) VALUES ($1, $2) RETURNING id`,
        [type, contextId]
    );

    const conversationId =
        created.rows[0].id;

    await pool.query(
        `
        INSERT INTO conversation_participants (conversation_id, student_id)
        VALUES ($1, $2), ($1, $3)
        ON CONFLICT DO NOTHING
        `,
        [conversationId, studentA, studentB]
    );

    return conversationId;

}


// ========================================
// CHAT — SEND A MESSAGE
// ========================================

// ========================================
// RESOLVE WHICH CONVERSATION A MESSAGE
// GOES INTO (shared by text + attachment
// send endpoints)
// ========================================

async function resolveConversationForSend(senderId, recipientId, requestedConversationId) {

    if (requestedConversationId) {

        const membershipCheck = await pool.query(
            `
            SELECT 1
            FROM conversation_participants
            WHERE conversation_id = $1
            AND student_id = $2
            LIMIT 1
            `,
            [requestedConversationId, senderId]
        );

        if (membershipCheck.rows.length === 0) {
            return { error: "You don't have access to this conversation." };
        }

        return { conversationId: requestedConversationId };

    }

    const conversationId =
        await findOrCreateNormalConversation(senderId, recipientId);

    return { conversationId };

}


app.post("/api/chat/messages", async (req, res) => {

    try {

        const { senderId, body, conversationId: requestedConversationId } = req.body;

        let { recipientId } = req.body;

        if (!senderId || !body || !body.trim()) {

            return res.status(400).json({
                success: false,
                message: "Message cannot be empty."
            });

        }

        if (!recipientId && !requestedConversationId) {

            return res.status(400).json({
                success: false,
                message: "Missing recipientId or conversationId."
            });

        }

        if (recipientId) {

            const recipientCheck = await pool.query(
                `SELECT id FROM students WHERE id = $1 LIMIT 1`,
                [recipientId]
            );

            if (recipientCheck.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "That student could not be found."
                });

            }

        }

        let conversationId;

        if (requestedConversationId) {

            // Sending into a specific conversation — confirm
            // real membership, then find who else (if anyone
            // yet) is actually in it. An unclaimed support
            // conversation may have no one else yet — that's
            // fine, the message still saves and will be
            // visible once a staffer picks it up.

            const membershipCheck = await pool.query(
                `
                SELECT 1 FROM conversation_participants
                WHERE conversation_id = $1 AND student_id = $2
                LIMIT 1
                `,
                [requestedConversationId, senderId]
            );

            if (membershipCheck.rows.length === 0) {

                return res.status(403).json({
                    success: false,
                    message: "You don't have access to this conversation."
                });

            }

            // Extra rule for support tickets specifically: being
            // a participant isn't enough on its own — a support
            // staffer must have actually claimed this ticket
            // before they're allowed to respond in it. The
            // student who opened the ticket can always send.

            const conversationCheck = await pool.query(
                `SELECT type, claimed_by FROM conversations WHERE id = $1 LIMIT 1`,
                [requestedConversationId]
            );

            if (conversationCheck.rows.length > 0 && conversationCheck.rows[0].type === "SUPPORT") {

                const senderCheck = await pool.query(
                    `SELECT is_support FROM students WHERE id = $1 LIMIT 1`,
                    [senderId]
                );

                const senderIsSupportStaff =
                    senderCheck.rows.length > 0 && senderCheck.rows[0].is_support;

                if (
                    senderIsSupportStaff &&
                    String(conversationCheck.rows[0].claimed_by) !== String(senderId)
                ) {

                    return res.status(403).json({
                        success: false,
                        message: "You need to pick up this ticket from the Support Pool before you can respond."
                    });

                }

            }

            conversationId = requestedConversationId;

            if (!recipientId) {

                const otherParticipant = await pool.query(
                    `
                    SELECT student_id FROM conversation_participants
                    WHERE conversation_id = $1 AND student_id != $2
                    LIMIT 1
                    `,
                    [conversationId, senderId]
                );

                recipientId =
                    otherParticipant.rows.length > 0 ?
                        otherParticipant.rows[0].student_id :
                        null;

            }

        } else {

            const resolved =
                await resolveConversationForSend(senderId, recipientId, null);

            if (resolved.error) {

                return res.status(403).json({
                    success: false,
                    message: resolved.error
                });

            }

            conversationId = resolved.conversationId;

        }

        if (recipientId) {

            const blockCheck = await pool.query(
                `
                SELECT 1 FROM blocked_students
                WHERE (blocker_id = $1 AND blocked_id = $2)
                OR (blocker_id = $2 AND blocked_id = $1)
                LIMIT 1
                `,
                [senderId, recipientId]
            );

            if (blockCheck.rows.length > 0) {

                return res.status(403).json({
                    success: false,
                    message: "This message could not be sent."
                });

            }

        }

        const result = await pool.query(
            `
            INSERT INTO messages (sender_id, recipient_id, body, conversation_id)
            VALUES ($1, $2, $3, $4)
            RETURNING *
            `,
            [senderId, recipientId, body.trim(), conversationId]
        );

        await pool.query(
            `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [conversationId]
        );

        const savedMessage =
            result.rows[0];


        // Deliver in real time if the recipient is
        // connected — the recipient's own poll/fetch
        // remains the source of truth either way, this
        // is purely for instant delivery. If there's no
        // recipient yet (unclaimed support ticket), there's
        // simply no one to notify yet.

        if (typeof io !== "undefined" && recipientId) {

            io.to("student:" + recipientId).emit(
                "new_message",
                savedMessage
            );

        }

        res.status(201).json({
            success: true,
            message: savedMessage
        });

    } catch (error) {

        console.error(
            "Send message error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not send your message."
        });

    }

});


// ========================================
// SEND AN ATTACHMENT (image, file, or
// voice note)
// ========================================

app.post(
    "/api/chat/messages/attachment",
    function (req, res, next) {

        chatAttachmentUpload.single("file")(req, res, function (err) {

            if (err) {

                return res.status(400).json({
                    success: false,
                    message: err.message || "Could not upload that file."
                });

            }

            next();

        });

    },
    async (req, res) => {

        try {

            const { senderId, recipientId, conversationId: requestedConversationId, messageType } = req.body;

            if (!req.file) {

                return res.status(400).json({
                    success: false,
                    message: "No file was uploaded."
                });

            }

            if (!senderId || !recipientId) {

                return res.status(400).json({
                    success: false,
                    message: "Missing senderId or recipientId."
                });

            }

            const recipientCheck = await pool.query(
                `SELECT id FROM students WHERE id = $1 LIMIT 1`,
                [recipientId]
            );

            if (recipientCheck.rows.length === 0) {

                return res.status(404).json({
                    success: false,
                    message: "That student could not be found."
                });

            }

            const resolved =
                await resolveConversationForSend(senderId, recipientId, requestedConversationId);

            if (resolved.error) {

                return res.status(403).json({
                    success: false,
                    message: resolved.error
                });

            }

            const conversationId =
                resolved.conversationId;

            const attachmentUrl =
                "/uploads/" + req.file.filename;

            const resolvedType =
                (messageType === "VOICE" || messageType === "IMAGE" || messageType === "FILE") ?
                    messageType :
                    (req.file.mimetype.startsWith("image/") ? "IMAGE" : "FILE");

            const bodyText =
                resolvedType === "VOICE" ?
                    "Voice note" :
                    (resolvedType === "IMAGE" ? "Photo" : req.file.originalname);

            const result = await pool.query(
                `
                INSERT INTO messages (
                    sender_id, recipient_id, body, conversation_id,
                    message_type, attachment_url, attachment_name, attachment_size
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                RETURNING *
                `,
                [
                    senderId,
                    recipientId,
                    bodyText,
                    conversationId,
                    resolvedType,
                    attachmentUrl,
                    req.file.originalname,
                    req.file.size
                ]
            );

            await pool.query(
                `UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
                [conversationId]
            );

            const savedMessage =
                result.rows[0];

            if (typeof io !== "undefined") {

                io.to("student:" + recipientId).emit(
                    "new_message",
                    savedMessage
                );

            }

            res.status(201).json({
                success: true,
                message: savedMessage
            });

        } catch (error) {

            console.error(
                "Send attachment error:",
                error.message
            );

            res.status(500).json({
                success: false,
                message: "Could not send that attachment."
            });

        }

    }
);


// ========================================
// REACT TO A MESSAGE (toggle)
// ========================================

app.post("/api/chat/messages/:id/react", async (req, res) => {

    try {

        const messageId = req.params.id;
        const { studentId, emoji } = req.body;

        if (!studentId || !emoji) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId or emoji."
            });

        }

        const messageCheck = await pool.query(
            `SELECT conversation_id FROM messages WHERE id = $1 LIMIT 1`,
            [messageId]
        );

        if (messageCheck.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Message not found."
            });

        }

        const membershipCheck = await pool.query(
            `
            SELECT 1 FROM conversation_participants
            WHERE conversation_id = $1 AND student_id = $2
            LIMIT 1
            `,
            [messageCheck.rows[0].conversation_id, studentId]
        );

        if (membershipCheck.rows.length === 0) {

            return res.status(403).json({
                success: false,
                message: "You don't have access to this conversation."
            });

        }

        // Toggle: if this exact reaction already exists from
        // this student, remove it; otherwise set/replace it
        // (one reaction per student per message).

        const existing = await pool.query(
            `SELECT emoji FROM message_reactions WHERE message_id = $1 AND student_id = $2`,
            [messageId, studentId]
        );

        if (existing.rows.length > 0 && existing.rows[0].emoji === emoji) {

            await pool.query(
                `DELETE FROM message_reactions WHERE message_id = $1 AND student_id = $2`,
                [messageId, studentId]
            );

        } else {

            await pool.query(
                `
                INSERT INTO message_reactions (message_id, student_id, emoji)
                VALUES ($1, $2, $3)
                ON CONFLICT (message_id, student_id)
                DO UPDATE SET emoji = EXCLUDED.emoji
                `,
                [messageId, studentId, emoji]
            );

        }

        const reactionsResult = await pool.query(
            `SELECT emoji, student_id FROM message_reactions WHERE message_id = $1`,
            [messageId]
        );

        const grouped = {};

        reactionsResult.rows.forEach(function (r) {

            if (!grouped[r.emoji]) {
                grouped[r.emoji] = { emoji: r.emoji, count: 0, reactedByMe: false };
            }

            grouped[r.emoji].count += 1;

            if (String(r.student_id) === String(studentId)) {
                grouped[r.emoji].reactedByMe = true;
            }

        });

        res.status(200).json({
            success: true,
            reactions: Object.values(grouped)
        });

    } catch (error) {

        console.error(
            "React to message error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not react to that message."
        });

    }

});


// ========================================
// EDIT A MESSAGE
// (only the sender, only within 15 minutes
// of sending, text messages only)
// ========================================

app.patch("/api/chat/messages/:id", async (req, res) => {

    try {

        const messageId = req.params.id;
        const { studentId, body } = req.body;

        if (!studentId || !body || !body.trim()) {

            return res.status(400).json({
                success: false,
                message: "Message cannot be empty."
            });

        }

        const messageResult = await pool.query(
            `SELECT * FROM messages WHERE id = $1 LIMIT 1`,
            [messageId]
        );

        if (messageResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Message not found."
            });

        }

        const message =
            messageResult.rows[0];

        if (String(message.sender_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "You can only edit your own messages."
            });

        }

        if (message.message_type && message.message_type !== "TEXT") {

            return res.status(400).json({
                success: false,
                message: "Only text messages can be edited."
            });

        }

        const ageMs =
            Date.now() - new Date(message.created_at).getTime();

        if (ageMs > 15 * 60 * 1000) {

            return res.status(400).json({
                success: false,
                message: "This message is too old to edit — edits are only allowed within 15 minutes."
            });

        }

        const updateResult = await pool.query(
            `
            UPDATE messages
            SET body = $1, edited_at = CURRENT_TIMESTAMP
            WHERE id = $2
            RETURNING *
            `,
            [body.trim(), messageId]
        );

        const updatedMessage =
            updateResult.rows[0];

        if (typeof io !== "undefined") {

            io.to("student:" + updatedMessage.recipient_id).emit(
                "message_edited",
                updatedMessage
            );

        }

        res.status(200).json({
            success: true,
            message: updatedMessage
        });

    } catch (error) {

        console.error(
            "Edit message error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not edit this message."
        });

    }

});


// ========================================
// SUBMIT A PRODUCT REVIEW
// (only students who actually bought and
// paid for the product)
// ========================================

app.post("/api/products/:id/reviews", async (req, res) => {

    try {

        const { id } = req.params;

        const { studentId, rating, comment } = req.body;

        if (!studentId || !rating) {

            return res.status(400).json({
                success: false,
                message: "Please provide a rating."
            });

        }

        const numericRating =
            parseInt(rating, 10);

        if (numericRating < 1 || numericRating > 5) {

            return res.status(400).json({
                success: false,
                message: "Rating must be between 1 and 5."
            });

        }


        // ====================================
        // CONFIRM THIS STUDENT ACTUALLY BOUGHT
        // THIS PRODUCT (a paid order containing it)
        // ====================================

        const ordersResult = await pool.query(
            `
            SELECT id, items
            FROM orders
            WHERE student_id = $1
            AND status = 'paid'
            `,
            [studentId]
        );

        let matchedOrderId = null;

        for (const order of ordersResult.rows) {

            let items = [];

            try {

                items =
                    typeof order.items === "string" ?
                        JSON.parse(order.items) :
                        order.items;

            } catch (error) {

                items = [];

            }

            const hasProduct =
                items.some(function (item) {
                    return String(item.id) === String(id);
                });

            if (hasProduct) {

                matchedOrderId = order.id;
                break;

            }

        }

        if (!matchedOrderId) {

            return res.status(403).json({
                success: false,
                message: "You can only review products you've purchased."
            });

        }

        const result = await pool.query(
            `
            INSERT INTO reviews (product_id, student_id, order_id, rating, comment)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (product_id, student_id)
            DO UPDATE SET rating = $4, comment = $5
            RETURNING *
            `,
            [id, studentId, matchedOrderId, numericRating, comment ? comment.trim() : null]
        );

        res.status(201).json({

            success: true,

            message: "Thanks for your review.",

            review: result.rows[0]

        });

    } catch (error) {

        console.error(
            "Submit review error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not submit your review."
        });

    }

});


// ========================================
// GET REVIEWS FOR A PRODUCT
// ========================================

app.get("/api/products/:id/reviews", async (req, res) => {

    try {

        const { id } = req.params;

        const reviewsResult = await pool.query(
            `
            SELECT
                reviews.rating,
                reviews.comment,
                reviews.created_at,
                students.first_name
            FROM reviews
            JOIN students ON students.id = reviews.student_id
            WHERE reviews.product_id = $1
            ORDER BY reviews.created_at DESC
            `,
            [id]
        );

        const average =
            reviewsResult.rows.length > 0 ?
                reviewsResult.rows.reduce(function (sum, r) { return sum + r.rating; }, 0) /
                    reviewsResult.rows.length :
                0;

        res.status(200).json({

            success: true,

            averageRating: Math.round(average * 10) / 10,

            reviewCount: reviewsResult.rows.length,

            reviews: reviewsResult.rows

        });

    } catch (error) {

        console.error(
            "Fetch reviews error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load reviews."
        });

    }

});


// ========================================
// PRODUCTS A STUDENT CAN REVIEW
// (bought, paid, not yet reviewed)
// ========================================

app.get("/api/students/reviewable-products", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const ordersResult = await pool.query(
            `SELECT id, items, created_at FROM orders WHERE student_id = $1 AND status = 'paid'`,
            [studentId]
        );

        const reviewedResult = await pool.query(
            `SELECT product_id FROM reviews WHERE student_id = $1`,
            [studentId]
        );

        const reviewedIds =
            new Set(
                reviewedResult.rows.map(function (r) { return String(r.product_id); })
            );

        const seenIds = new Set();
        const productIds = [];

        ordersResult.rows.forEach(function (order) {

            let items = [];

            try {

                items =
                    typeof order.items === "string" ?
                        JSON.parse(order.items) :
                        order.items;

            } catch (error) {

                items = [];

            }

            items.forEach(function (item) {

                const key = String(item.id);

                if (!reviewedIds.has(key) && !seenIds.has(key)) {

                    seenIds.add(key);
                    productIds.push(item.id);

                }

            });

        });

        if (productIds.length === 0) {

            return res.status(200).json({
                success: true,
                products: []
            });

        }

        const productsResult = await pool.query(
            `SELECT id, name, image_url FROM products WHERE id = ANY($1::int[])`,
            [productIds]
        );

        res.status(200).json({
            success: true,
            products: productsResult.rows
        });

    } catch (error) {

        console.error(
            "Fetch reviewable products error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load reviewable products."
        });

    }

});


// ========================================
// REAL-TIME CHAT (Socket.IO)
// ========================================

/*
    Requires "socket.io" in package.json —
    see the note at the bottom of this file
    for the exact dependency to add.
*/

const http = require("http");
const { Server } = require("socket.io");

const httpServer = http.createServer(app);

const io = new Server(httpServer, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});


// ========================================
// REAL ONLINE PRESENCE
// (a student can have multiple tabs/devices
// connected at once, so we count connections
// per student rather than a plain on/off flag —
// they're only "offline" once every connection
// has closed)
// ========================================

const onlineConnectionCounts = {};

function markStudentOnline(studentId) {

    onlineConnectionCounts[studentId] =
        (onlineConnectionCounts[studentId] || 0) + 1;

}

function markStudentOffline(studentId) {

    if (!onlineConnectionCounts[studentId]) {
        return;
    }

    onlineConnectionCounts[studentId] -= 1;

    if (onlineConnectionCounts[studentId] <= 0) {
        delete onlineConnectionCounts[studentId];
    }

}

io.on("connection", function (socket) {

    let joinedStudentId = null;


    // A client must explicitly "join" with a real,
    // existing student ID before it can receive
    // anything — never trust a bare connection.

    socket.on("join", async function (studentId) {

        try {

            if (!studentId) {
                return;
            }

            const studentCheck = await pool.query(
                `SELECT id FROM students WHERE id = $1 LIMIT 1`,
                [studentId]
            );

            if (studentCheck.rows.length === 0) {
                return;
            }

            joinedStudentId = studentId;

            socket.join("student:" + studentId);

            markStudentOnline(studentId);

        } catch (error) {

            console.error(
                "Socket join error:",
                error.message
            );

        }

    });


    // Typing indicator — relayed to the other
    // participant only, never broadcast widely.

    socket.on("typing", function (data) {

        if (!joinedStudentId || !data || !data.recipientId) {
            return;
        }

        io.to("student:" + data.recipientId).emit(
            "typing",
            { fromStudentId: joinedStudentId }
        );

    });


    socket.on("disconnect", function () {

        if (joinedStudentId) {
            markStudentOffline(joinedStudentId);
        }

    });

});


// ========================================
// WHO'S CURRENTLY ONLINE
// ========================================

app.get("/api/chat/online-students", function (req, res) {

    res.status(200).json({
        success: true,
        onlineIds: Object.keys(onlineConnectionCounts)
    });

});


// ========================================
// CONTACT SUPPORT (KSupport)
// ========================================

app.post("/api/chat/contact-support", async (req, res) => {

    try {

        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const studentCheck = await pool.query(
            `SELECT id, is_support FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (studentCheck.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Student not found."
            });

        }

        if (studentCheck.rows[0].is_support) {

            return res.status(400).json({
                success: false,
                message: "You're a KSupport staff member — support requests come to you, not from you."
            });

        }

        // If this student already has an open (unclaimed)
        // or claimed (actively being handled) support
        // conversation, reuse it rather than starting a
        // new one. Only start fresh once a previous one
        // has been closed out.

        const existing = await pool.query(
            `
            SELECT conversations.id
            FROM conversations
            JOIN conversation_participants cp ON cp.conversation_id = conversations.id
            WHERE conversations.type = 'SUPPORT'
            AND cp.student_id = $1
            AND conversations.support_status IN ('open', 'claimed')
            ORDER BY conversations.id DESC
            LIMIT 1
            `,
            [studentId]
        );

        let conversationId;
        let ticketNumber;

        if (existing.rows.length > 0) {

            conversationId = existing.rows[0].id;

            const existingTicket = await pool.query(
                `SELECT ticket_number FROM conversations WHERE id = $1`,
                [conversationId]
            );

            ticketNumber = existingTicket.rows[0].ticket_number;

        } else {

            ticketNumber = generateTicketNumber();

            const created = await pool.query(
                `
                INSERT INTO conversations (type, support_status, ticket_number)
                VALUES ('SUPPORT', 'open', $1)
                RETURNING id
                `,
                [ticketNumber]
            );

            conversationId = created.rows[0].id;

            await pool.query(
                `
                INSERT INTO conversation_participants (conversation_id, student_id)
                VALUES ($1, $2)
                ON CONFLICT DO NOTHING
                `,
                [conversationId, studentId]
            );

            // Automated "we got your request" message —
            // this is what makes the ticket feel answered
            // immediately, even before anyone picks it up.

            await sendKSupportAutoMessage(
                conversationId,
                studentId,
                KSUPPORT_TEMPLATES.received(ticketNumber)
            );

        }

        res.status(200).json({

            success: true,

            conversationId: conversationId,

            ticketNumber: ticketNumber,

            // The student never sees a real staffer's
            // identity — support always answers as Elkurios,
            // whether or not anyone has picked it up yet.

            supportStudentId: null,

            supportName: "Elkurios"

        });

    } catch (error) {

        console.error(
            "Contact support error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not start a conversation with support."
        });

    }

});


// ========================================
// SUPPORT POOL — unclaimed conversations
// any support staffer can see and pick up
// ========================================

app.get("/api/support/pool", async (req, res) => {

    try {

        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const staffCheck = await pool.query(
            `SELECT is_support FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (staffCheck.rows.length === 0 || !staffCheck.rows[0].is_support) {

            return res.status(403).json({
                success: false,
                message: "Only KSupport staff can view the support pool."
            });

        }

        const poolResult = await pool.query(
            `
            SELECT
                conversations.id AS conversation_id,
                conversations.created_at,
                conversations.support_status,
                conversations.ticket_number,
                conversations.claimed_at,
                conversations.resolved_at,
                student.id AS student_id,
                student.first_name,
                student.last_name,
                student.university,
                staffer.id AS claimed_by_id,
                staffer.first_name AS claimed_by_first_name,
                staffer.last_name AS claimed_by_last_name,
                latest.body AS last_message,
                latest.created_at AS last_message_at
            FROM conversations
            JOIN conversation_participants cp ON cp.conversation_id = conversations.id
            JOIN students AS student
                ON student.id = cp.student_id
                AND student.is_support = false
            LEFT JOIN students AS staffer
                ON staffer.id = conversations.claimed_by
            LEFT JOIN LATERAL (
                SELECT body, created_at
                FROM messages
                WHERE conversation_id = conversations.id
                ORDER BY created_at DESC
                LIMIT 1
            ) AS latest ON true
            WHERE conversations.type = 'SUPPORT'
            ORDER BY
                CASE conversations.support_status
                    WHEN 'open' THEN 0
                    WHEN 'claimed' THEN 1
                    WHEN 'resolved' THEN 2
                    ELSE 3
                END,
                conversations.created_at DESC
            `
        );

        res.status(200).json({
            success: true,
            pool: poolResult.rows
        });

    } catch (error) {

        console.error(
            "Fetch support pool error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load the support pool."
        });

    }

});


// ========================================
// CLAIM A SUPPORT CONVERSATION
// (exclusive — rejected if someone else
// already has it)
// ========================================

app.post("/api/support/pool/:conversationId/claim", async (req, res) => {

    try {

        const { conversationId } = req.params;
        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const staffCheck = await pool.query(
            `SELECT is_support FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (staffCheck.rows.length === 0 || !staffCheck.rows[0].is_support) {

            return res.status(403).json({
                success: false,
                message: "Only KSupport staff can claim support conversations."
            });

        }

        const conversationResult = await pool.query(
            `SELECT * FROM conversations WHERE id = $1 AND type = 'SUPPORT' LIMIT 1`,
            [conversationId]
        );

        if (conversationResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Support conversation not found."
            });

        }

        const conversation =
            conversationResult.rows[0];

        if (conversation.support_status !== "open") {

            return res.status(409).json({
                success: false,
                message:
                    conversation.support_status === "claimed" ?
                        "Someone else has already picked this up." :
                        "This conversation has already been closed."
            });

        }

        await pool.query(
            `
            UPDATE conversations
            SET support_status = 'claimed', claimed_by = $1, claimed_at = CURRENT_TIMESTAMP
            WHERE id = $2
            `,
            [studentId, conversationId]
        );

        await pool.query(
            `
            INSERT INTO conversation_participants (conversation_id, student_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            `,
            [conversationId, studentId]
        );

        const requesterResult = await pool.query(
            `
            SELECT student.id, student.first_name
            FROM conversation_participants cp
            JOIN students AS student ON student.id = cp.student_id AND student.is_support = false
            WHERE cp.conversation_id = $1
            LIMIT 1
            `,
            [conversationId]
        );

        if (requesterResult.rows.length > 0) {

            const requester =
                requesterResult.rows[0];

            await sendKSupportAutoMessage(
                conversationId,
                requester.id,
                KSUPPORT_TEMPLATES.assigned(
                    conversation.ticket_number || "your ticket",
                    requester.first_name || "there"
                )
            );

        }

        res.status(200).json({
            success: true,
            message: "Conversation claimed.",
            conversationId: Number(conversationId),
            ticketNumber: conversation.ticket_number
        });

    } catch (error) {

        console.error(
            "Claim support conversation error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not claim this conversation."
        });

    }

});


// ========================================
// END A SUPPORT SESSION
// (only the staffer who claimed it can end
// it — this frees the student up to start a
// fresh support request later if needed)
// ========================================

// ========================================
// SHARED HELPER — LOOK UP A SUPPORT TICKET
// AND ITS ORIGINAL REQUESTER
// ========================================

async function getSupportTicketAndRequester(conversationId) {

    const conversationResult = await pool.query(
        `SELECT * FROM conversations WHERE id = $1 AND type = 'SUPPORT' LIMIT 1`,
        [conversationId]
    );

    if (conversationResult.rows.length === 0) {
        return { conversation: null, requester: null };
    }

    const requesterResult = await pool.query(
        `
        SELECT student.id, student.first_name
        FROM conversation_participants cp
        JOIN students AS student ON student.id = cp.student_id AND student.is_support = false
        WHERE cp.conversation_id = $1
        LIMIT 1
        `,
        [conversationId]
    );

    return {
        conversation: conversationResult.rows[0],
        requester: requesterResult.rows.length > 0 ? requesterResult.rows[0] : null
    };

}


// ========================================
// RESOLVE A TICKET
// (issue addressed, but stays associated
// with the same staffer — a lighter state
// than fully closing it)
// ========================================

app.post("/api/support/:conversationId/resolve", async (req, res) => {

    try {

        const { conversationId } = req.params;
        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const { conversation, requester } =
            await getSupportTicketAndRequester(conversationId);

        if (!conversation) {

            return res.status(404).json({
                success: false,
                message: "Support conversation not found."
            });

        }

        if (String(conversation.claimed_by) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "Only the staff member handling this ticket can resolve it."
            });

        }

        await pool.query(
            `UPDATE conversations SET support_status = 'resolved', resolved_at = CURRENT_TIMESTAMP WHERE id = $1`,
            [conversationId]
        );

        if (requester) {

            await sendKSupportAutoMessage(
                conversationId,
                requester.id,
                KSUPPORT_TEMPLATES.resolved(
                    conversation.ticket_number || "your ticket",
                    requester.first_name || "there"
                )
            );

        }

        res.status(200).json({
            success: true,
            message: "Ticket marked as resolved."
        });

    } catch (error) {

        console.error(
            "Resolve ticket error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not resolve this ticket."
        });

    }

});


// ========================================
// CLOSE A TICKET
// (final state — a student contacting
// support again after this gets a brand
// new ticket)
// ========================================

app.post("/api/support/:conversationId/close", async (req, res) => {

    try {

        const { conversationId } = req.params;
        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const { conversation, requester } =
            await getSupportTicketAndRequester(conversationId);

        if (!conversation) {

            return res.status(404).json({
                success: false,
                message: "Support conversation not found."
            });

        }

        if (String(conversation.claimed_by) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "Only the staff member handling this ticket can close it."
            });

        }

        await pool.query(
            `UPDATE conversations SET support_status = 'closed' WHERE id = $1`,
            [conversationId]
        );

        if (requester) {

            await sendKSupportAutoMessage(
                conversationId,
                requester.id,
                KSUPPORT_TEMPLATES.closed(
                    conversation.ticket_number || "your ticket",
                    requester.first_name || "there"
                )
            );

        }

        res.status(200).json({
            success: true,
            message: "Ticket closed."
        });

    } catch (error) {

        console.error(
            "Close ticket error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not close this ticket."
        });

    }

});


// ========================================
// REOPEN A TICKET
// (any support staffer can reopen a closed
// or resolved ticket — reopening claims it
// for whoever does it)
// ========================================

app.post("/api/support/:conversationId/reopen", async (req, res) => {

    try {

        const { conversationId } = req.params;
        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const staffCheck = await pool.query(
            `SELECT is_support FROM students WHERE id = $1 LIMIT 1`,
            [studentId]
        );

        if (staffCheck.rows.length === 0 || !staffCheck.rows[0].is_support) {

            return res.status(403).json({
                success: false,
                message: "Only KSupport staff can reopen a ticket."
            });

        }

        const { conversation, requester } =
            await getSupportTicketAndRequester(conversationId);

        if (!conversation) {

            return res.status(404).json({
                success: false,
                message: "Support conversation not found."
            });

        }

        if (conversation.support_status !== "closed" && conversation.support_status !== "resolved") {

            return res.status(400).json({
                success: false,
                message: "Only a resolved or closed ticket can be reopened."
            });

        }

        await pool.query(
            `
            UPDATE conversations
            SET support_status = 'claimed', claimed_by = $1, claimed_at = CURRENT_TIMESTAMP, resolved_at = NULL
            WHERE id = $2
            `,
            [studentId, conversationId]
        );

        await pool.query(
            `
            INSERT INTO conversation_participants (conversation_id, student_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
            `,
            [conversationId, studentId]
        );

        if (requester) {

            await sendKSupportAutoMessage(
                conversationId,
                requester.id,
                KSUPPORT_TEMPLATES.reopened(
                    conversation.ticket_number || "your ticket",
                    requester.first_name || "there"
                )
            );

        }

        res.status(200).json({
            success: true,
            message: "Ticket reopened.",
            conversationId: Number(conversationId)
        });

    } catch (error) {

        console.error(
            "Reopen ticket error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not reopen this ticket."
        });

    }

});


// ========================================
// TRANSFER A TICKET
// (only the current claimant can transfer —
// releases it back to the open pool for
// another staffer to pick up)
// ========================================

app.post("/api/support/:conversationId/transfer", async (req, res) => {

    try {

        const { conversationId } = req.params;
        const { studentId } = req.body;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const { conversation, requester } =
            await getSupportTicketAndRequester(conversationId);

        if (!conversation) {

            return res.status(404).json({
                success: false,
                message: "Support conversation not found."
            });

        }

        if (String(conversation.claimed_by) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "Only the staff member currently handling this ticket can transfer it."
            });

        }

        await pool.query(
            `
            UPDATE conversations
            SET support_status = 'open', claimed_by = NULL, claimed_at = NULL
            WHERE id = $1
            `,
            [conversationId]
        );

        await pool.query(
            `
            DELETE FROM conversation_participants
            WHERE conversation_id = $1 AND student_id = $2
            `,
            [conversationId, studentId]
        );

        if (requester) {

            await sendKSupportAutoMessage(
                conversationId,
                requester.id,
                KSUPPORT_TEMPLATES.transferred(
                    conversation.ticket_number || "your ticket",
                    requester.first_name || "there"
                )
            );

        }

        res.status(200).json({
            success: true,
            message: "Ticket transferred back to the support pool."
        });

    } catch (error) {

        console.error(
            "Transfer ticket error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not transfer this ticket."
        });

    }

});


// ========================================
// CHAT — CONTACT SELLER ABOUT A PRODUCT
// ========================================

app.post("/api/chat/contact-seller", async (req, res) => {

    try {

        const { studentId, productId } = req.body;

        if (!studentId || !productId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId or productId."
            });

        }

        const productResult = await pool.query(
            `
            SELECT
                products.id,
                products.name,
                products.seller_id,
                sellers.student_id AS seller_student_id,
                sellers.store_name
            FROM products
            LEFT JOIN sellers ON sellers.id = products.seller_id
            WHERE products.id = $1
            LIMIT 1
            `,
            [productId]
        );

        if (productResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Product not found."
            });

        }

        const product =
            productResult.rows[0];

        if (!product.seller_student_id) {

            return res.status(400).json({
                success: false,
                message: "This store hasn't linked a student account to chat with yet."
            });

        }

        if (String(product.seller_student_id) === String(studentId)) {

            return res.status(400).json({
                success: false,
                message: "You can't start a chat about your own product."
            });

        }

        const conversationId =
            await findOrCreateConversation(
                studentId,
                product.seller_student_id,
                "PRODUCT",
                product.id
            );

        res.status(200).json({

            success: true,

            conversationId: conversationId,

            sellerStudentId: product.seller_student_id,

            storeName: product.store_name,

            productName: product.name

        });

    } catch (error) {

        console.error(
            "Contact seller error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not start a conversation with this seller."
        });

    }

});


// ========================================
// ORDER — LIST DISTINCT SELLERS
// (an order can span multiple sellers,
// since checkout doesn't restrict the cart
// to one store)
// ========================================

app.get("/api/orders/:id/sellers", async (req, res) => {

    try {

        const { id } = req.params;
        const { studentId } = req.query;

        if (!studentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId."
            });

        }

        const orderResult = await pool.query(
            `SELECT * FROM orders WHERE id = $1 LIMIT 1`,
            [id]
        );

        if (orderResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Order not found."
            });

        }

        const order =
            orderResult.rows[0];

        if (String(order.student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your order."
            });

        }

        const productIds =
            (order.items || []).map(function (item) { return item.id; });

        if (productIds.length === 0) {

            return res.status(200).json({
                success: true,
                sellers: []
            });

        }

        const result = await pool.query(
            `
            SELECT DISTINCT
                sellers.id AS seller_id,
                sellers.store_name,
                sellers.student_id AS seller_student_id
            FROM products
            JOIN sellers ON sellers.id = products.seller_id
            WHERE products.id = ANY($1::int[])
            AND sellers.student_id IS NOT NULL
            AND sellers.student_id != $2
            `,
            [productIds, studentId]
        );

        res.status(200).json({
            success: true,
            sellers: result.rows
        });

    } catch (error) {

        console.error(
            "Fetch order sellers error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not load sellers for this order."
        });

    }

});


// ========================================
// CHAT — CONTACT A SELLER ABOUT AN ORDER
// (order-context conversation, distinct
// from a general product inquiry)
// ========================================

app.post("/api/chat/contact-seller-about-order", async (req, res) => {

    try {

        const { studentId, orderId, sellerStudentId } = req.body;

        if (!studentId || !orderId || !sellerStudentId) {

            return res.status(400).json({
                success: false,
                message: "Missing studentId, orderId, or sellerStudentId."
            });

        }

        const orderResult = await pool.query(
            `SELECT student_id FROM orders WHERE id = $1 LIMIT 1`,
            [orderId]
        );

        if (orderResult.rows.length === 0) {

            return res.status(404).json({
                success: false,
                message: "Order not found."
            });

        }

        if (String(orderResult.rows[0].student_id) !== String(studentId)) {

            return res.status(403).json({
                success: false,
                message: "This isn't your order."
            });

        }

        const conversationId =
            await findOrCreateConversation(studentId, sellerStudentId, "ORDER", orderId);

        res.status(200).json({
            success: true,
            conversationId: conversationId
        });

    } catch (error) {

        console.error(
            "Contact seller about order error:",
            error.message
        );

        res.status(500).json({
            success: false,
            message: "Could not start a conversation about this order."
        });

    }

});


// ========================================
// START SERVER
// ========================================

const PORT = process.env.PORT || 3000;

runMigrations()
    .then(() => {

        httpServer.listen(PORT, () => {
            console.log(`Kurios Stores server is running on port ${PORT}`);
            console.log("Real-time chat (Socket.IO) is ready.");
        });

    })
    .catch((error) => {

        console.error(
            "Startup migrations failed — starting the server anyway so the site doesn't go fully dark, but some features may not work correctly until this is resolved:",
            error.message
        );

        httpServer.listen(PORT, () => {
            console.log(`Kurios Stores server is running on port ${PORT}`);
            console.log("Real-time chat (Socket.IO) is ready.");
        });

    });
