const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const sqlite3 = require("sqlite3").verbose();
const ExcelJS = require("exceljs");
const PDFDocument = require("pdfkit");
const fs = require("fs");
const session = require("express-session");
const multer = require("multer");


const app = express();
const PORT = 3000;
const upload = multer({ dest: "uploads/" });

// Hardcoded login credentials
const USERNAME = "admin";
const PASSWORD = "12345";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); // for check out
app.use(express.static(path.join(__dirname, "public")));

// Setup session
app.use(
  session({
    secret: "joska-secret-key", // you can change this
    resave: false,
    saveUninitialized: true,
  })
);
// ---- DATABASE ----
const db = new sqlite3.Database("./database.db", (err) => {
  if (err) console.error(err.message);
  else console.log("✅ Connected to SQLite database");
});


// Create users table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    role TEXT CHECK(role IN ('admin','cashier'))
  )
`, (err) => {
  if (err) {
    console.error("Failed to create users table:", err);
    return;
  }

  // Now safe to check default cashier
  db.get("SELECT * FROM users WHERE username = ?", ["cashier"], (err, row) => {
    if (err) {
      console.error("Error checking cashier:", err);
    } else if (!row) {
      db.run(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        ["cashier", "cash123", "cashier"],
        (err2) => {
          if (err2) console.error("Failed to insert cashier:", err2.message);
          else console.log("✅ Default cashier created: username='cashier', password='cash123'");
        }
      );
    }
  });

  // Check default admin
  db.get("SELECT * FROM users WHERE username = ?", ["admin"], (err, row) => {
    if (err) {
      console.error("Error checking admin:", err);
    } else if (!row) {
      db.run(
        "INSERT INTO users (username, password, role) VALUES (?, ?, ?)",
        ["admin", "admin123", "admin"],
        (err2) => {
          if (err2) console.error("Failed to insert admin:", err2.message);
          else console.log("✅ Default admin created: username='admin', password='admin123'");
        }
      );
    }
  });
});

// Middleware to protect dashboard
//role based middleware
// Middleware: Admin only
function requireAdmin(req, res, next) {
  if (req.session && req.session.role === "admin") return next();

  // If unauthorized, render current page (or a default page) with error
  res.render('forbidden', { session: { error: "❌ Forbidden: Admins only" } });
}

// Middleware: Cashier or Admin
function requireCashierOrAdmin(req, res, next) {
  if (req.session && (req.session.role === "admin" || req.session.role === "cashier")) return next();

  res.render('forbidden', { session: { error: "❌ Forbidden: You don't have access to this page" } });
}



// GET / → show login page
app.get("/", (req, res) => {
  res.render("login", { error: null });
});

// Login page
app.post("/login", (req, res) => {
  const { username, password, role } = req.body;

  db.get(
    "SELECT * FROM users WHERE username = ? AND password = ? AND role = ?",
    [username, password, role],
    (err, user) => {
      if (err) {
        console.error(err);
        return res.render("login", { error: "DB error, try again" });
      }

      if (user) {
        req.session.loggedIn = true;
        req.session.username = user.username;
        req.session.role = user.role;
        res.redirect("/dashboard");
      } else {
        res.render("login", { error: "Invalid username, password, or role!" });
      }
    }
  );
});



// Dashboard (protected)
app.get("/dashboard", requireCashierOrAdmin, (req, res) => {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

  db.serialize(() => {
    db.get("SELECT COUNT(*) AS total FROM products", (err, row1) => {
      const totalProducts = row1 ? row1.total : 0;

      db.get(
        "SELECT COUNT(*) AS lowStock FROM products WHERE remainingQty < 5",
        (err, row2) => {
          const lowStockCount = row2 ? row2.lowStock : 0; // 👈 use count only here

          db.get(
            "SELECT IFNULL(SUM(amount), 0) AS revenue FROM sales WHERE date = ?",
            [today],
            (err, row3) => {
              const todaysRevenue = row3 ? row3.revenue : 0;

              db.get(
                "SELECT IFNULL(SUM(profit), 0) AS profit FROM sales WHERE date = ?",
                [today],
                (err, row4) => {
                  const todaysProfit = row4 ? row4.profit : 0;

                  //This months revenue
                  db.get(
                    "SELECT IFNULL(SUM(amount), 0) AS revenue FROM sales WHERE strftime('%Y-%m', date) = ?",
                    [currentMonth],
                    (err, monthRow) => {
                      const monthsRevenue = monthRow ? monthRow.revenue : 0;

                    // This Month Profit
                  db.get(
                        "SELECT IFNULL(SUM(profit), 0) AS profit FROM sales WHERE strftime('%Y-%m', date) = ?",
                        [currentMonth],
                        (err, monthProfitRow) => {
                         const monthsProfit = monthProfitRow ? monthProfitRow.profit : 0;

                  db.get(
                    "SELECT COUNT(*) AS unpaid FROM sales WHERE status = 'unpaid'",
                    (err, row5) => {
                      const unpaidProducts = row5 ? row5.unpaid : 0;

                      // 🔹 Now get credits
                  db.all("SELECT * FROM credits", [], (err, rows) => {
                    if (err) {
                      console.error(err);
                      return res.status(500).send("DB error");
                    }

                // Only customers with balance (total > paid)
                      const debtors = rows.filter(r => r.total > r.paid);
                      
                      // Query details of low stock products
                    db.all(
                      "SELECT name, code, remainingQty FROM products WHERE remainingQty < 5",
                      (err, lowStockRows) => {
                        if (err) {
                          console.error(err);
                          return res.status(500).send("DB error");
                      }
                                      

                      res.render("dashboard", {
                              todayDate: today,
                              totalProducts,
                              lowStockCount,             // 👈 card shows count
                              lowStockProducts: lowStockRows, // 👈 modal shows details
                              todaysRevenue,
                              todaysProfit,
                              unpaidProducts,
                              creditReport: debtors.length,
                              credits: debtors,// 👈 full product list
                              monthsRevenue,  // 👈 new
                              monthsProfit,// 👈 new
                              userRole: req.session.role   // ✅ add this   
                                  });
                                }
                              );
                            }
                          );
                        }
                      );
                     }
                    );
                   }
                  );
                }
              );
            }
          );
        }
      );
    });
  });
});





// Create products table if not exists
db.run(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE,
    name TEXT,
    soldQty INTEGER DEFAULT 0,
    remainingQty INTEGER,
    actualPrice REAL,
    sellingPrice REAL
  )
`);

// ---- ROUTES ----

// Show products
app.get("/products",requireAdmin, (req, res) => {
  db.all("SELECT * FROM products", [], (err, rows) => {
    if (err) throw err;
    res.render("products", { products: rows });
  });
});

// Utility: Generate unique 4-digit code
function generateProductCode(callback) {
  function tryCode() {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    db.get("SELECT * FROM products WHERE code = ?", [code], (err, row) => {
      if (row) {
        tryCode(); // code exists, retry
      } else {
        callback(code);
      }
    });
  }
  tryCode();
}

// Add Product Form
app.get("/products/add", requireAdmin,(req, res) => {
  generateProductCode((code) => {
    res.render("addProduct", { code, error: null });
  });
});

app.post("/products/add", requireAdmin,(req, res) => {
  const { code, name, remainingQty, actualPrice, sellingPrice } = req.body;

  db.get(
    "SELECT * FROM products WHERE LOWER(name) = LOWER(?)",
    [name],
    (err, row) => {
      if (row) {
        // Product already exists
        return res.render("addProduct", {
          code,
          error: "❌ Product already exists!",
        });
      }

      // Insert new product
      db.run(
        `INSERT INTO products (code, name, remainingQty, actualPrice, sellingPrice)
         VALUES (?, ?, ?, ?, ?)`,
        [code, name, remainingQty, actualPrice, sellingPrice],
        (err2) => {
          if (err2) {
            console.error(err2.message);
            return res.render("addProduct", {
              code,
              error: "⚠️ Failed to save product.",
            });
          }
          res.redirect("/products");
        }
      );
    }
  );
});

// Edit (show form)
app.get("/products/edit/:id", requireAdmin,(req, res) => {
  db.get("SELECT * FROM products WHERE id = ?", [req.params.id], (err, row) => {
    if (err) {
      console.error(err);
      return res.status(500).send("DB error");
    }
    if (!row) return res.status(404).send("Product not found");
    res.render("editProduct", { product: row });
  });
});

// Edit (submit)
app.post("/products/edit/:id", requireAdmin,(req, res) => {
  const { code, name, soldQty, remainingQty, actualPrice, sellingPrice } =
    req.body;
  db.run(
    `UPDATE products
     SET code = ?, name = ?, soldQty = ?, remainingQty = ?, actualPrice = ?, sellingPrice = ?
     WHERE id = ?`,
    [
      code,
      name,
      soldQty,
      remainingQty,
      actualPrice,
      sellingPrice,
      req.params.id,
    ],
    function (err) {
      if (err) {
        console.error(err.message);
        return res.status(400).send("Failed to update product.");
      }
      res.redirect("/products");
    }
  );
});

// Delete (POST for safety)
app.post("/products/delete/:id",requireAdmin, (req, res) => {
  db.run("DELETE FROM products WHERE id = ?", [req.params.id], function (err) {
    if (err) {
      console.error(err.message);
      return res.status(400).send("Failed to delete product.");
    }
    res.redirect("/products");
  });
});


// Import products from Excel
app.post("/products/import", upload.single("excelFile"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).send("No file uploaded");
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(req.file.path);
    const sheet = workbook.worksheets[0]; // first sheet

    // Skip header row, loop rows
    for (let i = 2; i <= sheet.rowCount; i++) {
      const row = sheet.getRow(i);

      const name = row.getCell(1).value;         // Column A → Product Name
      const remainingQty = row.getCell(2).value; // Column B → Remaining Qty
      const actualPrice = row.getCell(3).value;  // Column C → Actual Price
      const sellingPrice = row.getCell(4).value; // Column D → Selling Price

      if (!name) continue; // skip empty

      // Check if product already exists
      db.get("SELECT * FROM products WHERE LOWER(name) = LOWER(?)", [name], (err, existing) => {
        if (err) return console.error(err);

        if (!existing) {
          // Generate unique code before insert
          generateProductCode((code) => {
            db.run(
              `INSERT INTO products (code, name, remainingQty, actualPrice, sellingPrice)
               VALUES (?, ?, ?, ?, ?)`,
              [code, name, remainingQty || 0, actualPrice || 0, sellingPrice || 0],
              (err2) => {
                if (err2) console.error("Insert error:", err2.message);
              }
            );
          });
        }
      });
    }

    res.redirect("/products"); // back to products page
  } catch (err) {
    console.error("Import error:", err.message);
    res.status(500).send("Failed to import products");
  }
});


// Logout route
app.get("/logout", requireCashierOrAdmin, (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

//Sales table
db.run(`CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoiceNo TEXT,
  productCode TEXT,
  productName TEXT,
  qty INTEGER,
  price REAL,
  amount REAL,
  profit REAL,
  date TEXT,
  paymentMode TEXT DEFAULT 'cash',
  status TEXT DEFAULT 'paid'
)`);
//Searching through
// API: search products by name (for suggestions)
app.get("/api/products/search", (req, res) => {
  const q = req.query.q ? req.query.q.toLowerCase() : "";
  if (!q) return res.json([]);

  db.all(
    "SELECT name FROM products WHERE LOWER(name) LIKE ? LIMIT 10",
    [`%${q}%`],
    (err, rows) => {
      if (err) {
        console.error("DB search error:", err);
        return res.status(500).json([]);
      }
      res.json(rows.map((r) => r.name));
    }
  );
});

// API: get product by code or name (case-insensitive for name)
app.get("/api/product/", (req, res) => {
  const { code, name } = req.query;
  if (code) {
    db.get("SELECT * FROM products WHERE code = ?", [code], (err, row) => {
      if (err) return res.status(500).json({ error: "DB error" });
      res.json(row || {});
    });
  } else if (name) {
    db.get(
      "SELECT * FROM products WHERE LOWER(name) = LOWER(?)",
      [name],
      (err, row) => {
        if (err) return res.status(500).json({ error: "DB error" });
        res.json(row || {});
      }
    );
  } else {
    res.json({});
  }
});

//checking out sales
app.post("/checkout", (req, res) => {
  try {
    const { cart, paidAmount, paymentMode } = req.body;
    const today = new Date().toISOString().slice(0, 10);
    const invoiceNo = "INV" + Date.now();

    let total = 0;

    db.serialize(() => {
      cart.forEach((item) => {
        const amount = item.qty * item.price;

        // ✅ Calculate profit correctly
        const profitPerUnit = item.price - item.actualPrice;
        const profit = profitPerUnit * item.qty;

        total += amount;

        db.run(
          `INSERT INTO sales (invoiceNo, productCode, productName, qty, price, amount, profit, date, paymentMode, status) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            invoiceNo,
            item.productCode,
            item.productName,
            item.qty,
            item.price,
            amount,
            profit,
            today,
            paymentMode || "cash",
            "paid",
          ]
        );

        //update products
        db.get("SELECT remainingQty FROM products WHERE code = ?", [item.productCode], (err, row) => {
            if (err || !row) {
              console.error("Product not found:", item.productCode);
              return; // skip this item
            }

            if (row.remainingQty < item.qty) {
              console.error("⚠️ Not enough stock for", item.productCode);
              return; // skip if insufficient stock
            }

            // Only update if stock is enough
            db.run(
              `UPDATE products 
              SET remainingQty = remainingQty - ?, 
                  soldQty = soldQty + ? 
              WHERE code = ?`,
              [item.qty, item.qty, item.productCode]
            );

          });
      });
    });

    res.json({ success: true, invoiceNo, total });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, error: "Checkout failed" });
  }
});

// Delete sale record
app.post("/sales/delete/:id",requireAdmin, (req, res) => {
  const saleId = req.params.id;

  db.get("SELECT * FROM sales WHERE id = ?", [saleId], (err, sale) => {
    if (err || !sale) {
      console.error(err);
      return res.status(400).send("Sale not found.");
    }

    // Try to find product by code
    db.get(
      "SELECT * FROM products WHERE code = ?",
      [sale.productCode],
      (err2, product) => {
        if (err2) {
          console.error(err2);
          return res.status(500).send("DB error.");
        }

        if (product) {
          // ✅ If product exists → reverse the sale
          db.run(
            `UPDATE products
           SET remainingQty = remainingQty + ?,
               soldQty = soldQty - ?
           WHERE code = ?`,
            [sale.qty, sale.qty, sale.productCode],
            function (err3) {
              if (err3) {
                console.error(err3);
                return res.status(500).send("Failed to update product.");
              }

              // Finally delete sale
              db.run(
                "DELETE FROM sales WHERE id = ?",
                [saleId],
                function (err4) {
                  if (err4) {
                    console.error(err4);
                    return res.status(500).send("Failed to delete sale.");
                  }
                  res.redirect("/sales-report");
                }
              );
            }
          );
        } else {
          // ❌ Product no longer exists → just delete the sale
          db.run("DELETE FROM sales WHERE id = ?", [saleId], function (err5) {
            if (err5) {
              console.error(err5);
              return res.status(500).send("Failed to delete sale.");
            }
            res.redirect("/sales-report");
          });
        }
      }
    );
  });
});

// Get filtered sales report
app.get("/sales-report", requireAdmin,(req, res) => {
  let { fromDate, toDate, productName, year, month, week } = req.query;

  let query = `SELECT * FROM sales WHERE 1=1`;
  let params = [];

  // Date range filter
  if (fromDate && toDate) {
    query += ` AND date BETWEEN ? AND ?`;
    params.push(fromDate, toDate);
  }

  // Product filter
  if (productName) {
    query += ` AND productName LIKE ?`;
    params.push(`%${productName}%`);
  }

  // Year filter
  if (year) {
    query += ` AND strftime('%Y', date) = ?`;
    params.push(year);
  }

  // Month filter (works only if year also selected or date has year-month format)
  if (month) {
    query += ` AND strftime('%m', date) = ?`;
    params.push(month.padStart(2, "0")); // ensures "01".."12"
  }

  // Current week filter
  if (week === "current") {
    query += ` AND strftime('%W', date) = strftime('%W', 'now') 
               AND strftime('%Y', date) = strftime('%Y', 'now')`;
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).send("Database error: " + err.message);

    // ✅ Render EJS instead of sending JSON
    res.render("sales-report", { sales: rows, filters: req.query });
  });
});
// Export to Excel
app.get("/export-excel", (req, res) => {
  let { fromDate, toDate, productName, year, month, week } = req.query;

  let query = `SELECT * FROM sales WHERE 1=1`;
  let params = [];

  if (fromDate && toDate) {
    query += ` AND date BETWEEN ? AND ?`;
    params.push(fromDate, toDate);
  }
  if (productName) {
    query += ` AND productName LIKE ?`;
    params.push(`%${productName}%`);
  }
  if (year) {
    query += ` AND strftime('%Y', date) = ?`;
    params.push(year);
  }
  if (month) {
    query += ` AND strftime('%m', date) = ?`;
    params.push(month.padStart(2, "0"));
  }
  if (week === "current") {
    query += ` AND strftime('%W', date) = strftime('%W', 'now') 
               AND strftime('%Y', date) = strftime('%Y', 'now')`;
  }

  db.all(query, params, async (err, rows) => {
    if (err) return res.status(500).send("Database error: " + err.message);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sales Report");

    sheet.columns = [
      { header: "Invoice No", key: "invoiceNo", width: 15 },
      { header: "Product Code", key: "productCode", width: 15 },
      { header: "Product Name", key: "productName", width: 20 },
      { header: "Quantity", key: "qty", width: 10 },
      { header: "Price", key: "price", width: 10 },
      { header: "Amount", key: "amount", width: 10 },
      { header: "Profit", key: "profit", width: 10 },
      { header: "Date", key: "date", width: 15 },
      { header: "Payment Mode", key: "paymentMode", width: 15 },
      { header: "Status", key: "status", width: 10 },
    ];

    rows.forEach((row) => {
      sheet.addRow(row);
    });

    const filePath = path.join(__dirname, "sales_report.xlsx");
    await workbook.xlsx.writeFile(filePath);

    res.download(filePath, "sales_report.xlsx", (err) => {
      if (err) console.error(err);
      fs.unlinkSync(filePath); // delete after sending
    });
  });
});

// Export to PDF
app.get("/export-pdf", (req, res) => {
  let { fromDate, toDate, productName, year, month, week } = req.query;

  let query = `SELECT * FROM sales WHERE 1=1`;
  let params = [];

  if (fromDate && toDate) {
    query += ` AND date BETWEEN ? AND ?`;
    params.push(fromDate, toDate);
  }
  if (productName) {
    query += ` AND productName LIKE ?`;
    params.push(`%${productName}%`);
  }
  if (year) {
    query += ` AND strftime('%Y', date) = ?`;
    params.push(year);
  }
  if (month) {
    query += ` AND strftime('%m', date) = ?`;
    params.push(month.padStart(2, "0"));
  }
  if (week === "current") {
    query += ` AND strftime('%W', date) = strftime('%W', 'now') 
               AND strftime('%Y', date) = strftime('%Y', 'now')`;
  }

  db.all(query, params, (err, rows) => {
    if (err) return res.status(500).send("Database error: " + err.message);

    const doc = new PDFDocument({ margin: 30, size: "A4" });
    const filePath = path.join(__dirname, "sales_report.pdf");
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    doc.fontSize(18).text("Sales Report", { align: "center" }).moveDown();

    rows.forEach((row) => {
      doc
        .fontSize(10)
        .text(
          `Invoice: ${row.invoiceNo}, Product: ${row.productName}, Qty: ${row.qty}, Amount: ${row.amount}, Profit: ${row.profit}, Date: ${row.date}, Payment: ${row.paymentMode}, Status: ${row.status}`
        );
    });

    doc.end();

    stream.on("finish", () => {
      res.download(filePath, "sales_report.pdf", (err) => {
        if (err) console.error(err);
        fs.unlinkSync(filePath); // delete after sending
      });
    });
  });
});

// Create credits table if not exists
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS credits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoiceNo TEXT,
      customerName TEXT,
      phone TEXT,
      nationalID TEXT,
      productCode TEXT,
      productName TEXT,
      qty INTEGER,
      total REAL,
      paid REAL,
      paymentMode TEXT,
      createdAt TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// ================= CREDIT ROUTES =================

// Show credit form
app.get("/credit",requireCashierOrAdmin,(req, res) => {
  res.render("credit");
});


// Save new credit
app.post("/credit", (req, res) => {
  const {
    customerName,
    phone,
    nationalID,
    productCode,
    productName,
    qty,
    total,
    paid,
    paymentMode,
  } = req.body;
  const invoiceNo = "CR" + Date.now();

    // Convert to numbers (important!)
  const totalNum = parseFloat(total) || 0;
  const paidNum = parseFloat(paid) || 0;

  // ✅ Validation
  if (paidNum === totalNum) {
    return res.render("credit", {
      error: "This is a full payment, please make a normal sale instead.",
    });
  }

  if (paidNum > totalNum) {
    return res.render("credit", {
      error: "Paid amount cannot exceed total amount.",
    });
  }

  // ✅ Step 1: Check stock first
  db.get("SELECT remainingQty FROM products WHERE code = ?", [productCode], (err, product) => {
    if (err || !product) {
  console.error(err);
  return res.render("credit", { 
    error: "❌ Product not found.", 
    formData: req.body 
  });
}


    if (product.remainingQty < qty) {
     return res.render("credit", { error: "❌ Not enough stock available.", formData: req.body });
    }


    // ✅ Step 2: Insert into credits
    db.run(
      `INSERT INTO credits 
        (invoiceNo, customerName, phone, nationalID, productCode, productName, qty, total, paid, paymentMode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        invoiceNo,
        customerName,
        phone,
        nationalID,
        productCode,
        productName,
        qty,
        total,
        paid,
        paymentMode,
      ],
      function (err2) {
        if (err2) {
          console.error(err2.message);
          return res.status(500).send("Failed to save credit sale.");
        }

        // ✅ Step 3: Update Stock Deduct stock only if inserted successfully
        db.run(
          `UPDATE products 
           SET remainingQty = remainingQty - ? 
           WHERE code = ?`,
          [qty, productCode],
          function (err3) {
            if (err3) console.error("Failed to update stock after credit:", err3.message);
            res.redirect("/credit-report");
          }
        );
      }
    );
  });
});


// Credit Report
app.get("/credit-report", requireCashierOrAdmin,(req, res) => {
  db.all("SELECT * FROM credits ORDER BY createdAt DESC", [], (err, rows) => {
    if (err) {
      console.error(err.message);
      return res.status(500).send("Failed to fetch credit report.");
    }
    res.render("creditReport", { credits: rows });
  });
});

// Live product search in credit (autocomplete)
app.get("/api/products/search-credit", (req, res) => {
  const term = req.query.term;
  db.all(
    "SELECT * FROM products WHERE name LIKE ? OR code LIKE ? LIMIT 10",
    [`%${term}%`, `%${term}%`],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json([]);
      }
      res.json(rows);
    }
  );
});





// ✅ Settle credit (mark as fully paid + move to sales, increase soldQty)
app.get("/credit/settle/:id", (req, res) => {
  const creditId = req.params.id;

  db.get("SELECT * FROM credits WHERE id = ?", [creditId], (err, credit) => {
    if (err || !credit) {
      console.error(err);
      return res.status(404).send("Credit not found.");
    }

    const today = new Date().toISOString().slice(0, 10);

    db.get(
      "SELECT actualPrice FROM products WHERE code = ?",
      [credit.productCode],
      (err2, product) => {
        if (err2 || !product) {
          console.error(err2);
          return res.status(500).send("Failed to fetch product details.");
        }

        const costPrice = product.actualPrice || 0;
        const unitSellingPrice = credit.total / credit.qty;
        const profit = (unitSellingPrice - costPrice) * credit.qty;

        // Insert into sales
        db.run(
          `INSERT INTO sales (invoiceNo, productCode, productName, qty, price, amount, profit, date, paymentMode, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            credit.invoiceNo,
            credit.productCode,
            credit.productName,
            credit.qty,
            unitSellingPrice,
            credit.total,
            profit,
            today,
            credit.paymentMode,
            "paid",
          ],
          function (err3) {
            if (err3) {
              console.error(err3.message);
              return res.status(500).send("Failed to settle credit.");
            }

            // ✅ Increase soldQty here (NOT at delete)
            db.run(
              `UPDATE products 
               SET soldQty = soldQty + ? 
               WHERE code = ?`,
              [credit.qty, credit.productCode],
              function (err4) {
                if (err4) {
                  console.error("Failed to update soldQty:", err4.message);
                }

                // Finally remove from credits
                db.run("DELETE FROM credits WHERE id = ?", [creditId], function (err5) {
                  if (err5) console.error(err5.message);
                  res.redirect("/credit-report");
                });
              }
            );
          }
        );
      }
    );
  });
});

// ❌ Delete credit (cancel sale) → Restore stock only
app.post("/credit/delete/:id", (req, res) => {
  const creditId = req.params.id;

  db.get("SELECT * FROM credits WHERE id = ?", [creditId], (err, credit) => {
    if (err || !credit) {
      console.error("Credit not found:", err);
      return res.status(404).send("Credit not found.");
    }

    // ✅ Restore stock (reverse credit)
    db.run(
      `UPDATE products 
       SET remainingQty = remainingQty + ? 
       WHERE code = ?`,
      [credit.qty, credit.productCode],
      function (err2) {
        if (err2) {
          console.error("Failed to restore stock:", err2.message);
        }

        // Remove credit record
        db.run("DELETE FROM credits WHERE id = ?", [creditId], function (err3) {
          if (err3) console.error(err3.message);
          res.redirect("/credit-report");
        });
      }
    );
  });
});

// Add partial payment
app.post("/credit/pay/:id", (req, res) => {
  const creditId = req.params.id;
  const { amount } = req.body;

  db.get("SELECT * FROM credits WHERE id = ?", [creditId], (err, credit) => {
    if (err || !credit) {
      console.error(err);
      return res.status(404).send("Credit not found.");
    }

    const newPaid = credit.paid + parseFloat(amount);

    if (newPaid < credit.total) {
      // Just update paid amount
      db.run("UPDATE credits SET paid = ? WHERE id = ?", [newPaid, creditId], (err2) => {
        if (err2) console.error(err2);
        res.redirect("/credit-report");
      });
    } else {
      // Full payment reached → move to sales
      const today = new Date().toISOString().slice(0, 10);

      db.get("SELECT actualPrice FROM products WHERE code = ?", [credit.productCode], (err3, product) => {
        const costPrice = product ? product.actualPrice : 0;
        const unitSellingPrice = credit.total / credit.qty;
        const profit = (unitSellingPrice - costPrice) * credit.qty;

        db.run(
          `INSERT INTO sales (invoiceNo, productCode, productName, qty, price, amount, profit, date, paymentMode, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            credit.invoiceNo,
            credit.productCode,
            credit.productName,
            credit.qty,
            unitSellingPrice,
            credit.total,
            profit,
            today,
            credit.paymentMode,
            "paid",
          ],
          (err4) => {
            if (err4) {
              console.error(err4);
              return res.status(500).send("Failed to record sale.");
            }

            // Update product stock soldQty only (no need to deduct again, already deducted at credit)
            db.run(
              `UPDATE products 
               SET soldQty = soldQty + ? 
               WHERE code = ?`,
              [credit.qty, credit.productCode]
            );

            // Remove from credits
            db.run("DELETE FROM credits WHERE id = ?", [creditId], () => {
              res.redirect("/credit-report");
            });
          }
        );
      });
    }
  });
});

// Show all credit sales (Credit Report)
app.get("/credit/report", requireCashierOrAdmin, (req, res) => {
  db.all("SELECT * FROM credits", [], (err, rows) => {
    if (err) {
      console.error("❌ Error fetching credits:", err);
      return res.status(500).send("Database error");
    }
    res.render("creditReport", { credits: rows });
  });
});



//Users--Profile
// Change password for any user (admin only)
app.get("/users", requireAdmin, (req, res) => {
  db.all("SELECT id, username, role FROM users", [], (err, rows) => {
    if (err) {
      return res.render("users", { users: [], error: "DB error", success: null });
    }
    res.render("users", { users: rows, error: null, success: null });
  });
});
// Change password for any user (admin only)
app.post("/users/change-password/:username", requireAdmin, (req, res) => {
  const { newPassword, confirmPassword } = req.body;
  const username = req.params.username;

  if (newPassword !== confirmPassword) {
    // Fetch users again before showing error
    return db.all("SELECT id, username, role FROM users", [], (err, rows) => {
      if (err) {
        console.error(err);
        return res.render("users", { users: [], error: "DB error", success: null });
      }
      res.render("users", { users: rows, error: "Passwords do not match", success: null });
    });
  }

  db.run("UPDATE users SET password = ? WHERE username = ?", [newPassword, username], function(err) {
    if (err) {
      console.error(err);
      return db.all("SELECT id, username, role FROM users", [], (err2, rows) => {
        if (err2) {
          console.error(err2);
          return res.render("users", { users: [], error: "DB error", success: null });
        }
        res.render("users", { users: rows, error: "Failed to update password", success: null });
      });
    }
    res.redirect("/users?success=Password updated successfully");
  });
});


// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
