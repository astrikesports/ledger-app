import { useState, useEffect, useLayoutEffect } from "react";
import { supabase } from "./supabase";

const getFY = (dateStr) => {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  if (m >= 4) return `${y}-${(y + 1).toString().slice(-2)}`;
  return `${y - 1}-${y.toString().slice(-2)}`;
};

const format = (num) => `₹${Number(num || 0).toLocaleString("en-IN")}`;

const daysDiff = (dateStr) => {
  if (!dateStr) return 0;
  const d = new Date(dateStr);
  const today = new Date();
  return Math.floor((today - d) / (1000 * 60 * 60 * 24));
};

export default function DueTrackerAdvanced() {
  const [dark, setDark] = useState(() => {
  const saved = localStorage.getItem("theme");
  return saved ? saved === "dark" : false;
});

  useLayoutEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", dark);
    localStorage.setItem("theme", dark ? "dark" : "light");
  }, [dark]);
  const [entries, setEntries] = useState([]);

  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [daysFilter, setDaysFilter] = useState("ALL");
  const [selectedParty, setSelectedParty] = useState("ALL");
  const [selectedSales, setSelectedSales] = useState("ALL");
  const [stateSearch, setStateSearch] = useState("");
  const [selectedFY, setSelectedFY] = useState("ALL");
  const [currentPage, setCurrentPage] = useState(1);
  const [editId, setEditId] = useState(null);
  const rowsPerPage = 10;

  const [form, setForm] = useState({
    date: "",
    billNo: "",
    party: "",
    salesperson: "",
    state: "",
    method: "",
    paymentType: "", // NEW (CREDIT / COD)
    total: "",
    received: "",
    type: "SALE",
  });

  

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
  };

  const fetchData = async () => {
  const { data } = await supabase
    .from("entries")
    .select("*")
    .order("date", { ascending: true });
  setEntries(data || []);
};

useEffect(() => {
  fetchData();
}, []);

const addEntry = async () => {
  try {
    if (!form.party) return;

    const payload = {
      date: form.date,
      billNo: form.billNo,
      party: form.party,
      salesperson: form.salesperson,
      state: form.state,
      method: form.method,
      paymentType: form.paymentType,
      type: form.type,
      total: Number(form.total || 0),
      received: Number(form.received || 0),
    };

    if (editId !== null) {
      const { error } = await supabase.from("entries").update(payload).eq("id", editId);
      if (error) throw error;
      setEditId(null);
    } else {
      const { error } = await supabase.from("entries").insert([payload]);
      if (error) throw error;
    }

    await fetchData();

    setForm({ date: "", billNo: "", party: "", salesperson: "", state: "", method: "", paymentType: "", total: "", received: "", type: "SALE" });
  } catch (err) {
    console.error("Supabase Error:", err.message);
    alert("Insert failed: " + err.message);
  }
};
  // removed old local state logic (was breaking Supabase flow)


  const handleEdit = (row) => {
    setForm({
      date: row.date,
      billNo: row.billNo,
      party: row.party,
      salesperson: row.salesperson || "",
      state: row.state || "",
      method: row.method || "",
      paymentType: row.paymentType || "",
      total: row.total,
      received: row.received,
      type: row.type || "SALE",
    });
    setEditId(row.id);
  };

  const handleDelete = async (id) => {
  await supabase.from("entries").delete().eq("id", id);
  fetchData();
};

  const partyList = ["ALL", ...new Set(entries.map((e) => e.party))];
  const salesList = ["ALL", ...new Set(entries.map((e) => e.salesperson).filter(Boolean))];
  const fyList = ["ALL", ...new Set(entries.map((e) => getFY(e.date)).filter(Boolean))];

  const getLedgerRows = () => {
    let filtered = entries.filter((e) =>
      e.party.toLowerCase().includes(search.toLowerCase())
    );

    if (stateSearch) {
      filtered = filtered.filter(e => (e.state || "").toLowerCase().includes(stateSearch.toLowerCase()));
    }

    if (selectedSales !== "ALL") {
      filtered = filtered.filter(e => e.salesperson === selectedSales);
    }

    if (selectedParty !== "ALL") {
      filtered = filtered.filter((e) => e.party === selectedParty);
    }

    if (selectedFY !== "ALL") {
      filtered = filtered.filter((e) => getFY(e.date) === selectedFY);
    }

    filtered = filtered.sort((a, b) => new Date(a.date) - new Date(b.date));

    let partyBalances = {};

    // FINAL FIFO FIX (2 PASS - CORRECT)
    let partyQueues = {};
    let billRemainingMap = {};

    // PASS 1: APPLY ALL PAYMENTS
    filtered.forEach((e) => {
      const sale = Number(e.total || 0);
      const payment = Number(e.received || 0);

      if (!partyQueues[e.party]) partyQueues[e.party] = [];

      if (sale > 0) {
        partyQueues[e.party].push({ id: e.id, remaining: sale, date: e.date });
      }

      let payLeft = payment;
      while (payLeft > 0 && partyQueues[e.party].length > 0) {
        const first = partyQueues[e.party][0];

        if (first.remaining > payLeft) {
          first.remaining -= payLeft;
          payLeft = 0;
        } else {
          payLeft -= first.remaining;
          partyQueues[e.party].shift();
        }
      }
    });

    // STORE FINAL REMAINING
    Object.keys(partyQueues).forEach((party) => {
      partyQueues[party].forEach((b) => {
        billRemainingMap[b.id] = b.remaining;
      });
    });

    // PASS 2: MAP RESULT
    return filtered.map((e) => {
      const sale = Number(e.total || 0);
      const payment = Number(e.received || 0);

      const billRemaining = billRemainingMap[e.id] || 0; // per bill due

      // FIX: due should be per party only (not global)
      const due = Object.entries(billRemainingMap)
        .filter(([id, _]) => {
          const row = filtered.find(x => x.id == id);
          return row && row.party === e.party;
        })
        .reduce((a, [_, b]) => a + b, 0);
      // FIXED: advance should be calculated party-wise (not per row)
      const partyTotalSale = filtered
        .filter(x => x.party === e.party)
        .reduce((a, b) => a + Number(b.total || 0), 0);

      const partyTotalPayment = filtered
        .filter(x => x.party === e.party)
        .reduce((a, b) => a + Number(b.received || 0), 0);

      const advance = partyTotalPayment > partyTotalSale
        ? partyTotalPayment - partyTotalSale
        : 0;

      let status = "CLEARED";

      if (e.type === "PAYMENT") {
        status = e.type;
      } else {
        if (billRemaining === 0) status = "CLEARED";
        else if (billRemaining < sale) status = "PARTIAL";
        else status = "PENDING";
      }

      const days = billRemaining > 0 ? daysDiff(e.date) : 0;

      return {
        ...e,
        payment,
        sale,
        billDue: billRemaining, // ✅ NEW (per bill due)
        due,
        advance,
        status,
        fy: getFY(e.date),
        days,
      };
    });
    
  };

  let ledgerRows = getLedgerRows();

  // STATUS FILTER
  if (filter === "PENDING") ledgerRows = ledgerRows.filter(r => r.status === "PENDING");
  if (filter === "ADVANCE") ledgerRows = ledgerRows.filter(r => r.status === "ADVANCE");
  if (filter === "CLEARED") ledgerRows = ledgerRows.filter(r => r.status === "CLEARED");

  // DAYS FILTER
  if (daysFilter === ">30") ledgerRows = ledgerRows.filter(r => r.days > 30);
  if (daysFilter === "25-30") ledgerRows = ledgerRows.filter(r => r.days >= 25 && r.days <= 30);
  if (daysFilter === "15-25") ledgerRows = ledgerRows.filter(r => r.days > 15 && r.days < 25);

  // FIX: remove pagination (show all rows)
  const paginatedRows = ledgerRows;

  // detect party from search also
  const searchedParties = [...new Set(entries
    .filter(e => e.party.toLowerCase().includes(search.toLowerCase()))
    .map(e => e.party))];

  const activeParty = selectedParty !== "ALL" ? selectedParty : (searchedParties.length === 1 ? searchedParties[0] : "ALL");

  const partyFiltered = entries
    .filter(e => e.party.toLowerCase().includes(search.toLowerCase()))
    .filter(e => activeParty === "ALL" ? true : e.party === activeParty)
    .filter(e => selectedFY === "ALL" ? true : getFY(e.date) === selectedFY);

  const partySale = partyFiltered.reduce((a,b)=>a+Number(b.total||0),0);
  const partyPayment = partyFiltered.reduce((a,b)=>a+Number(b.received||0),0);
  const partyBalance = partySale - partyPayment;

  // 🆕 SALESPERSON SUMMARY
  const salesFiltered = entries
    .filter(e => selectedSales === "ALL" ? true : e.salesperson === selectedSales);

  const salesTotalSale = salesFiltered.reduce((a,b)=>a+Number(b.total||0),0);
  const salesTotalPayment = salesFiltered.reduce((a,b)=>a+Number(b.received||0),0);
  const salesBalance = salesTotalSale - salesTotalPayment;

  const lastPaymentParty = partyFiltered
    .filter(e => e.type === "PAYMENT")
    .sort((a,b)=> new Date(b.date)-new Date(a.date))[0];

  // FIX: compute days from ONLY outstanding (unpaid) sale bills
  const maxDueDays = partyBalance > 0
    ? ledgerRows
        .filter(r => r.party === activeParty && r.type === "SALE" && r.status !== "CLEARED")
        .map(r => r.days)
        .reduce((a,b)=> Math.max(a,b), 0)
    : 0;

  return (
    <div className={dark ? "p-6 w-full bg-gray-900 text-white min-h-screen" : "p-6 w-full bg-white text-black min-h-screen"}>

      {/* HEADER + FILTERS */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-6">
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold">💼 Ledger Pro</h1>
          <button
            onClick={() => setDark(!dark)}
            className="ml-2 px-3 py-1 rounded-lg border border-gray-300 dark:border-gray-600 text-sm bg-white dark:bg-gray-800 text-black dark:text-white hover:bg-gray-100 dark:hover:bg-gray-700 transition"
          >
            {dark ? "☀️ Light" : "🌙 Dark"}
          </button>
        </div>

        <div className="grid grid-cols-2 md:flex gap-2">
          <input
            placeholder="🔍 Search Party"
            value={search}
            onChange={(e)=>{setSearch(e.target.value); setCurrentPage(1);}}
            className={dark ? "border border-gray-600 bg-gray-800 text-white px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition" : "border border-gray-200 bg-white text-black px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200 transition"}
          />

          <select value={activeParty} onChange={(e)=>{setSelectedParty(e.target.value); setCurrentPage(1);}} className={dark ? "border border-gray-600 bg-gray-800 text-white px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition" : "border border-gray-200 bg-white text-black px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200 transition"}>
            {partyList.map(p=><option key={p}>{p}</option>)}
          </select>

          <select value={selectedFY} onChange={(e)=>{setSelectedFY(e.target.value); setCurrentPage(1);}} className={dark ? "border border-gray-600 bg-gray-800 text-white px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition" : "border border-gray-200 bg-white text-black px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200 transition"}>
            {fyList.map(fy=><option key={fy}>{fy}</option>)}
          </select>

          <select value={selectedSales} onChange={(e)=>setSelectedSales(e.target.value)} className={dark ? "border border-gray-600 bg-gray-800 text-white px-4 py-2.5 rounded-xl" : "border border-gray-200 bg-white text-black px-4 py-2.5 rounded-xl"}>
            {salesList.map(s=><option key={s}>{s}</option>)}
          </select>

          <input
            placeholder="State search"
            value={stateSearch}
            onChange={(e)=>setStateSearch(e.target.value)}
            className={dark ? "border border-gray-600 bg-gray-800 text-white px-4 py-2.5 rounded-xl" : "border border-gray-200 bg-white text-black px-4 py-2.5 rounded-xl"}
          />

          <select value={filter} onChange={(e)=>setFilter(e.target.value)} className={dark ? "border border-gray-600 bg-gray-800 text-white px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition" : "border border-gray-200 bg-white text-black px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200 transition"}>
            <option value="ALL">All Status</option>
            <option value="PENDING">Pending</option>
            <option value="ADVANCE">Advance</option>
            <option value="CLEARED">Cleared</option>
          </select>

          <select value={daysFilter} onChange={(e)=>setDaysFilter(e.target.value)} className={dark ? "border border-gray-600 bg-gray-800 text-white px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-400 transition" : "border border-gray-200 bg-white text-black px-4 py-2.5 rounded-xl shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-200 transition"}>
            <option value="ALL">All Days</option>
            <option value=">30">&gt; 30 Days</option>
            <option value="25-30">25 - 30 Days</option>
            <option value="15-25">15 - 25 Days</option>
          </select>
        </div>
      </div>

      {/* SUMMARY */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className={dark ? "bg-red-900/30 border border-red-700 rounded-2xl p-4" : "bg-red-50 border border-red-200 rounded-2xl p-4"}>
          <p className={dark ? "text-sm text-gray-300" : "text-sm text-gray-700"}>Total Sale</p>
          <h2 className={dark ? "text-red-300 font-bold" : "text-red-600 font-bold"}>{format(entries.reduce((a,b)=>a+Number(b.total||0),0))}</h2>
        </div>
        <div className={dark ? "bg-green-900/30 border border-green-700 rounded-2xl p-4" : "bg-green-50 border border-green-200 rounded-2xl p-4"}>
          <p className={dark ? "text-sm text-gray-300" : "text-sm text-gray-700"}>Total Payment</p>
          <h2 className={dark ? "text-green-300 font-bold" : "text-green-600 font-bold"}>{format(entries.reduce((a,b)=>a+Number(b.received||0),0))}</h2>
        </div>
        <div className={dark ? "bg-blue-900/30 border border-blue-700 rounded-2xl p-4" : "bg-blue-50 border border-blue-200 rounded-2xl p-4"}>
          <p className={dark ? "text-sm text-gray-300" : "text-sm text-gray-700"}>Net</p>
          <h2 className={dark ? "text-blue-300 font-bold" : "text-blue-700 font-bold"}>{format(entries.reduce((a,b)=>a+Number(b.total||0),0)-entries.reduce((a,b)=>a+Number(b.received||0),0))}</h2>
        </div>
      </div>

      {/* FORM */}
      <div className="grid grid-cols-2 md:grid-cols-9 gap-2 mb-4">
        <input type="date" name="date" value={form.date} onChange={handleChange} className={dark ? "border border-gray-600 bg-gray-800 text-white px-2 py-1 rounded-md text-sm" : "border border-gray-300 bg-white text-black px-2 py-1 rounded-md text-sm"} />
        <input name="billNo" value={form.billNo} onChange={handleChange} placeholder="Bill" className={dark ? "border border-gray-600 bg-gray-800 text-white px-2 py-1 rounded-md text-sm" : "border border-gray-300 bg-white text-black px-2 py-1 rounded-md text-sm"} />
        <input name="party" value={form.party} onChange={handleChange} placeholder="Party" className={dark ? "border border-gray-600 bg-gray-800 text-white px-2 py-1 rounded-md text-sm" : "border border-gray-300 bg-white text-black px-2 py-1 rounded-md text-sm"} />

        <input name="salesperson" value={form.salesperson} onChange={handleChange} placeholder="Sales Person" className={dark ? "border border-gray-600 bg-gray-800 text-white px-2 py-1 rounded-md text-sm" : "border border-gray-300 bg-white text-black px-2 py-1 rounded-md text-sm"} />

        <input name="state" value={form.state} onChange={handleChange} placeholder="State" className={dark ? "border border-gray-600 bg-gray-800 text-white px-2 py-1 rounded-md text-sm" : "border border-gray-300 bg-white text-black px-2 py-1 rounded-md text-sm"} />

        <select name="type" value={form.type} onChange={handleChange} className={dark ? "border border-gray-600 bg-gray-800 text-white px-2 py-1 rounded-md text-sm" : "border border-gray-300 bg-white text-black px-2 py-1 rounded-md text-sm"}>
          <option value="SALE">Sale</option>
          <option value="PAYMENT">Payment</option>
        </select>

        <select name="paymentType" value={form.paymentType} onChange={handleChange} className={dark ? "border border-gray-600 bg-gray-800 text-white px-2 py-1 rounded-md text-sm" : "border border-gray-300 bg-white text-black px-2 py-1 rounded-md text-sm"}>
          <option value="">Credit / COD</option>
          <option value="CREDIT">Credit</option>
          <option value="COD">COD</option>
        </select>

        <input name="total" value={form.total} onChange={handleChange} placeholder="Sale" className={dark ? "border border-gray-600 bg-gray-800 text-white px-2 py-1 rounded-md text-sm" : "border border-gray-300 bg-white text-black px-2 py-1 rounded-md text-sm"} />
        <input name="received" value={form.received} onChange={handleChange} placeholder="Payment" className={dark ? "border border-gray-600 bg-gray-800 text-white px-2 py-1 rounded-md text-sm" : "border border-gray-300 bg-white text-black px-2 py-1 rounded-md text-sm"} />

        <select name="method" value={form.method} onChange={handleChange} className={dark ? "border border-gray-600 bg-gray-800 text-white px-2 py-1 rounded-md text-sm" : "border border-gray-300 bg-white text-black px-2 py-1 rounded-md text-sm"}>
          <option value="">Method</option>
          <option value="CASH">Cash</option>
          <option value="BANK">Bank</option>
          <option value="UPI">UPI</option>
        </select>

        <div className="col-span-2 md:col-span-9 flex gap-2 justify-center mt-2">
          <button
            onClick={addEntry}
            className={`text-white active:scale-95 transition px-8 py-2 rounded-md min-w-[140px] text-center ${editId ? "bg-yellow-500 hover:bg-yellow-600" : "bg-blue-600 hover:bg-blue-700"}`}
          >
            {editId ? "Update" : "Add"}
          </button>

          {editId && (
            <button
              onClick={() => {
                setEditId(null);
                setForm({ date: "", billNo: "", party: "", salesperson: "", state: "", method: "", paymentType: "", total: "", received: "", type: "SALE" });
              }}
              className={`px-8 py-2 rounded-md min-w-[140px] text-center text-white active:scale-95 transition ${dark ? "bg-gray-600 hover:bg-gray-700" : "bg-gray-400 hover:bg-gray-500"}`}
            >
              ✖ Cancel
            </button>
          )}
        </div>
      </div>

      {/* SALESPERSON CARD */}
      <div className={dark ? "bg-purple-900/30 border border-purple-700 rounded-2xl p-4 mb-4" : "bg-purple-50 border border-purple-200 rounded-2xl p-4 mb-4"}>
        <h2 className={dark ? "font-semibold text-lg text-purple-300 mb-2" : "font-semibold text-lg text-purple-700 mb-2"}>
          {selectedSales === "ALL" ? "All Salespersons" : selectedSales} (Sales Summary)
        </h2>
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <p className={dark ? "text-gray-300" : "text-gray-600"}>Total Sale</p>
            <p className={dark ? "font-bold text-red-300" : "font-bold text-red-600"}>{format(salesTotalSale)}</p>
          </div>
          <div>
            <p className={dark ? "text-gray-300" : "text-gray-600"}>Total Payment</p>
            <p className={dark ? "font-bold text-green-300" : "font-bold text-green-600"}>{format(salesTotalPayment)}</p>
          </div>
          <div>
            <p className={dark ? "text-gray-300" : "text-gray-600"}>Due</p>
            <p className={dark ? "font-bold text-red-300" : "font-bold text-red-600"}>{salesBalance > 0 ? format(salesBalance) : "—"}</p>
          </div>
        </div>
      </div>

      {/* PARTY CARD */}
      {activeParty !== "ALL" && (
        <div
          className={
            dark
              ? (
                  maxDueDays > 30
                    ? "border-2 border-red-600 bg-gray-800 rounded-2xl shadow-lg shadow-red-500/40 p-4 mb-4 animate-pulse"
                    : maxDueDays >= 25
                    ? "border border-red-700 bg-gray-800 rounded-2xl shadow-sm p-4 mb-4"
                    : maxDueDays > 15
                    ? "border border-yellow-700 bg-gray-800 rounded-2xl shadow-sm p-4 mb-4"
                    : "border border-gray-700 bg-gray-800 rounded-2xl shadow-sm p-4 mb-4"
                )
              : (
                  maxDueDays > 30
                    ? "border-2 border-red-500 bg-white rounded-2xl shadow-lg shadow-red-400/40 p-4 mb-4 animate-pulse"
                    : maxDueDays >= 25
                    ? "border border-red-300 bg-white rounded-2xl shadow-sm p-4 mb-4"
                    : maxDueDays > 15
                    ? "border border-yellow-300 bg-white rounded-2xl shadow-sm p-4 mb-4"
                    : "border border-gray-200 bg-white rounded-2xl shadow-sm p-4 mb-4"
                )
          }
        >
          <div className="flex justify-between items-center mb-3">
            <div>
              <h2 className={dark ? "font-semibold text-lg text-white" : "font-semibold text-lg text-gray-900"}>
                {activeParty}
              </h2>
              <p className={dark ? "text-xs text-gray-300" : "text-xs text-gray-500"}>
                Party Summary
              </p>
            </div>
            <div
              className={`text-xs px-2 py-1 rounded font-semibold ${
                partyBalance <= 0
                  ? dark
                    ? "bg-green-900/40 text-green-300"
                    : "bg-green-100 text-green-700"
                  : maxDueDays > 30
                  ? dark
                    ? "bg-red-600 text-white animate-pulse"
                    : "bg-red-500 text-white animate-pulse"
                  : maxDueDays >= 25
                  ? dark
                    ? "bg-red-900/40 text-red-300"
                    : "bg-red-100 text-red-700"
                  : maxDueDays > 15
                  ? dark
                    ? "bg-yellow-900/40 text-yellow-300"
                    : "bg-yellow-100 text-yellow-700"
                  : dark
                  ? "bg-gray-700 text-gray-300"
                  : "bg-gray-100 text-gray-700"
              }`}
            >
              {partyBalance <= 0 ? "ALL CLEARED" : `${maxDueDays} days due`}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
            <div>
              <p className={dark ? "text-gray-300" : "text-gray-600"}>Total Sale</p>
              <p className={dark ? "font-bold text-red-300" : "font-bold text-red-600"}>
                {format(partySale)}
              </p>
            </div>
            <div>
              <p className={dark ? "text-gray-300" : "text-gray-600"}>Total Payment</p>
              <p className={dark ? "font-bold text-green-300" : "font-bold text-green-600"}>
                {format(partyPayment)}
              </p>
            </div>
            <div>
              <p className={dark ? "text-gray-300" : "text-gray-600"}>Due</p>
              <p className={dark ? "font-bold text-red-300" : "font-bold text-red-600"}>
                {partyBalance > 0 ? format(partyBalance) : "—"}
              </p>
            </div>
            <div>
              <p className={dark ? "text-gray-300" : "text-gray-600"}>Advance</p>
              <p className={dark ? "font-bold text-blue-300" : "font-bold text-blue-600"}>
                {partyBalance < 0 ? format(Math.abs(partyBalance)) : "—"}
              </p>
            </div>
            <div>
              <p className={dark ? "text-gray-300" : "text-gray-600"}>Last Payment</p>
              <p className={dark ? "font-semibold text-white" : "font-semibold text-gray-900"}>
                {lastPaymentParty
                  ? `${format(lastPaymentParty.received)} (${lastPaymentParty.date})`
                  : "No Payment"}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* TABLE */}
      <div className={dark ? "overflow-auto rounded-2xl shadow border border-gray-700" : "overflow-auto rounded-2xl shadow border border-gray-200"}>
        <table className={dark ? "w-full text-sm text-white" : "w-full text-sm text-gray-800"}>
          <thead className={dark ? "bg-gray-700 text-white sticky top-0 z-10" : "bg-blue-50 text-gray-900 border-b border-gray-200 sticky top-0 z-10"}>
            <tr className="text-left">
              <th className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-900 font-semibold"}>Date</th>
              <th className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-900 font-semibold"}>Party</th>
              <th className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-900 font-semibold"}>Bill No</th>
              <th className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-900 font-semibold"}>Sales Person</th>
              <th className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-900 font-semibold"}>State</th>
              <th className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-900 font-semibold"}>Type</th>
              <th className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-900 font-semibold"}>Method</th>
              <th className="px-4 py-3 text-right">Sale</th>
              <th className="px-4 py-3 text-right">Payment</th>
              <th className="px-4 py-3 text-right">Bill Due</th>
              <th className="px-4 py-3 text-right">Total Due</th>
              <th className="px-4 py-3 text-right">Advance</th>
              <th className="px-4 py-3 text-center">Status</th>
              <th className="px-4 py-3 text-center">Days</th>
              <th className="px-4 py-3 text-center">Action</th>
            </tr>
          </thead>
          <tbody>
            {paginatedRows.map((row, i) => (
              <tr
                key={row.id}
                className={`border-t ${dark ? "border-gray-700 hover:bg-gray-700" : "border-gray-200 hover:bg-blue-50"} transition cursor-pointer ${
                  i % 2 === 0
                    ? dark
                      ? "bg-gray-800"
                      : "bg-white"
                    : dark
                    ? "bg-gray-800/50"
                    : "bg-blue-50/30"
                } ${
                  row.billDue > 0
                    ? dark
                      ? "ring-1 ring-red-500/50 shadow-lg shadow-red-900/30"
                      : "bg-red-50 ring-1 ring-red-300"
                    : ""
                }`
              >
                <td className={dark ? "px-4 py-3 whitespace-nowrap text-white" : "px-4 py-3 whitespace-nowrap text-gray-800"}>{row.date}</td>
                <td className={dark ? "px-4 py-3 font-medium text-white" : "px-4 py-3 font-medium text-gray-900"}>{row.party}</td>
                <td className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-800"}>{row.billNo || "—"}</td>
                <td className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-800"}>{row.salesperson || "—"}</td>
                <td className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-800"}>{row.state || "—"}</td>

                <td className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-800 font-semibold"}>
                  <span className={`px-2 py-1 rounded-full text-xs font-bold ${row.type === "PAYMENT" ? (dark ? "bg-green-900/40 text-green-300" : "bg-green-100 text-green-700") : (dark ? "bg-blue-900/40 text-blue-300" : "bg-blue-100 text-blue-700")}`}>
                    {row.type}
                  </span>
                </td>

                <td className={dark ? "px-4 py-3 text-white" : "px-4 py-3 text-gray-800 font-medium"}>
                  {row.method || "—"} {row.paymentType ? (
                    <span className={`ml-1 text-xs px-1.5 py-0.5 rounded ${row.paymentType === "COD" ? (dark ? "bg-yellow-900/40 text-yellow-300" : "bg-yellow-100 text-yellow-700") : (dark ? "bg-gray-700 text-gray-300" : "bg-gray-100 text-gray-700")}`}>
                      {row.paymentType}
                    </span>
                  ) : ""}
                </td>

                <td className={dark ? "px-4 py-3 text-right text-red-300 font-semibold" : "px-4 py-3 text-right text-red-600 font-semibold"}>
                  {row.sale > 0 ? format(row.sale) : "—"}
                </td>

                <td className={dark ? "px-4 py-3 text-right text-green-300 font-semibold" : "px-4 py-3 text-right text-green-600 font-semibold"}>
                  {row.payment > 0 ? format(row.payment) : "—"}
                </td>

                <td className="px-4 py-3 text-right">
                  {row.billDue > 0 ? (
                    <span
                      className={`px-2 py-1 rounded-md text-xs font-bold ${
                        dark
                          ? "bg-red-900/40 text-red-300"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {format(row.billDue)}
                    </span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">—</span>
                  )}
                </td>

                <td className="px-4 py-3 text-right">
                  {row.due > 0 ? (
                    <span className={dark ? "text-red-300 font-semibold" : "text-red-600 font-semibold"}>{format(row.due)}</span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">—</span>
                  )}
                </td>

                <td className="px-4 py-3 text-right">
                  {row.advance > 0 ? (
                    <span className={dark ? "text-blue-300 font-semibold" : "text-blue-600 font-semibold"}>{format(row.advance)}</span>
                  ) : (
                    <span className="text-gray-400 dark:text-gray-500">—</span>
                  )}
                </td>

                <td className={dark ? "px-4 py-3 text-center text-gray-200" : "px-4 py-3 text-center"}>
                  {row.type === "PAYMENT" ? (
                    <span className="text-gray-400 dark:text-gray-500">—</span>
                  ) : (
                    <span
                      className={
                        "px-2 py-1 rounded-full text-xs font-semibold " +
                        (row.status === "PENDING"
                          ? (dark ? "bg-red-900/40 text-red-300" : "bg-red-100 text-red-700")
                          : row.status === "ADVANCE"
                          ? (dark ? "bg-blue-900/40 text-blue-300" : "bg-blue-100 text-blue-700")
                          : (dark ? "bg-green-900/40 text-green-300" : "bg-green-100 text-green-700"))
                      }
                    >
                      {row.status}
                    </span>
                  )}
                </td>

                <td className="px-4 py-3 text-center">
                  {row.type === "PAYMENT" ? (
                    <span className="text-gray-400 dark:text-gray-500">—</span>
                  ) : (
                    <span className={`px-2 py-1 rounded-full text-xs font-semibold ${row.days > 30 ? (dark ? "bg-red-600 text-white" : "bg-red-600 text-white") : row.days >= 25 ? (dark ? "bg-red-900/40 text-red-300" : "bg-red-200 text-red-700") : row.days > 15 ? (dark ? "bg-yellow-900/40 text-yellow-300" : "bg-yellow-100 text-yellow-700") : (dark ? "bg-gray-800 text-gray-300" : "bg-gray-100 text-gray-600")}`}>
                      {row.days}d
                    </span>
                  )}
                </td>

                <td className="px-4 py-3 text-center space-x-2 font-semibold">
                  <button
                    onClick={() => handleEdit(row)}
                    className={`px-2 py-1 text-xs rounded font-semibold ${dark ? "bg-blue-900/40 text-blue-300 hover:bg-blue-900/60" : "bg-blue-100 text-blue-700 hover:bg-blue-200"} active:scale-95 transition cursor-pointer`}
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(row.id)}
                    className={`px-2 py-1 text-xs rounded font-semibold ${dark ? "bg-red-900/40 text-red-300 hover:bg-red-900/60" : "bg-red-100 text-red-700 hover:bg-red-200"} active:scale-95 transition cursor-pointer`}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

    </div>
  );
}
