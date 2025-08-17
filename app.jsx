/* global React, ReactDOM */
const { useEffect, useMemo, useState, useCallback, useRef } = React;

/*************************
 * Utilities
 *************************/
const DateUtil = {
  toYMD(date){
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  },
  monthKey(date){
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2, '0');
    return `${y}-${m}`;
  },
  parseYMD(ymd){
    const [y, m, d] = ymd.split('-').map(Number);
    return new Date(y, m-1, d);
  },
  rangeOfMonth(year, monthIdx){
    const first = new Date(year, monthIdx, 1);
    const last = new Date(year, monthIdx+1, 0);
    return { first, last };
  },
  getMonthMatrix(year, monthIdx){
    const { first, last } = DateUtil.rangeOfMonth(year, monthIdx);
    const startDay = first.getDay(); // 0=Sun
    const daysInMonth = last.getDate();
    const days = [];
    for(let i=0;i<startDay;i++) days.push(null);
    for(let d=1; d<=daysInMonth; d++) days.push(new Date(year, monthIdx, d));
    while(days.length % 7 !== 0) days.push(null);
    return days;
  },
  monthName(year, monthIdx){
    return new Date(year, monthIdx, 1).toLocaleString(undefined, { month:'long', year:'numeric' });
  }
};

function classNames(...xs){ return xs.filter(Boolean).join(' '); }

async function sha256Hex(str){
  const data = new TextEncoder().encode(str);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2,'0')).join('');
}

/*************************
 * Minimal IndexedDB helper
 *************************/
const DB_NAME = 'tiffinDB';
const DB_VERSION = 1;
function openDb(){
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if(!db.objectStoreNames.contains('orders')){
        const store = db.createObjectStore('orders', { keyPath: 'id' });
        store.createIndex('by_date', 'date');
      }
      if(!db.objectStoreNames.contains('evidence')){
        db.createObjectStore('evidence', { keyPath: 'id' });
      }
      if(!db.objectStoreNames.contains('dayFlags')){
        db.createObjectStore('dayFlags', { keyPath: 'date' }); // {date, missed}
      }
    };
    req.onerror = () => reject(req.error);
    req.onsuccess = () => resolve(req.result);
  });
}

function tx(storeNames, mode, fn){
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    const stores = storeNames.map(name => tx.objectStore(name));
    const result = fn(...stores);
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
  }));
}

const OrdersRepo = {
  async bulkByDateRange(startYmd, endYmd){
    const all = await OrdersRepo.all();
    return all.filter(o => o.date >= startYmd && o.date <= endYmd);
  },
  async byDates(dates){
    const set = new Set(dates);
    const all = await OrdersRepo.all();
    return all.filter(o => set.has(o.date));
  },
  async add(order){
    return tx(['orders'], 'readwrite', (orders) => {
      orders.add(order);
    });
  },
  async update(order){
    return tx(['orders'], 'readwrite', (orders) => orders.put(order));
  },
  async delete(id){
    return tx(['orders'], 'readwrite', (orders) => orders.delete(id));
  },
  async bulkUpdate(ids, updater){
    return tx(['orders'], 'readwrite', (orders) => {
      const req = orders.openCursor();
      req.onsuccess = () => {
        const cursor = req.result;
        if(cursor){
          if(ids.includes(cursor.primaryKey)){
            const updated = updater({ ...cursor.value });
            cursor.update(updated);
          }
          cursor.continue();
        }
      };
    });
  },
  async all(){
    return new Promise((resolve, reject) => {
      tx(['orders'], 'readonly', (orders) => {
        const out = [];
        const req = orders.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if(cursor){ out.push(cursor.value); cursor.continue(); }
          else resolve(out);
        };
      }).catch(reject);
    });
  },
  async byDate(ymd){
    return new Promise((resolve, reject) => {
      tx(['orders'], 'readonly', (orders) => {
        const idx = orders.index('by_date');
        const range = IDBKeyRange.only(ymd);
        const out = [];
        const req = idx.openCursor(range);
        req.onsuccess = () => {
          const cursor = req.result;
          if(cursor){ out.push(cursor.value); cursor.continue(); }
          else resolve(out);
        };
      }).catch(reject);
    });
  }
};

const EvidenceRepo = {
  async save(blob){
    const id = crypto.randomUUID();
    const record = { id, blob, mimeType: blob.type || 'image/png', createdAt: new Date().toISOString() };
    await tx(['evidence'], 'readwrite', (evidence) => evidence.add(record));
    return id;
  },
  async get(id){
    return new Promise((resolve, reject) => {
      tx(['evidence'], 'readonly', (evidence) => {
        const req = evidence.get(id);
        req.onsuccess = () => resolve(req.result);
      }).catch(reject);
    });
  }
};

const DayFlagsRepo = {
  async get(date){
    return new Promise((resolve, reject) => {
      tx(['dayFlags'], 'readonly', (dayFlags) => {
        const req = dayFlags.get(date);
        req.onsuccess = () => resolve(req.result || { date, missed: false });
      }).catch(reject);
    });
  },
  async setMissed(date, missed){
    return tx(['dayFlags'], 'readwrite', (dayFlags) => dayFlags.put({ date, missed }));
  },
  async listForMonth(year, monthIdx){
    const { first, last } = DateUtil.rangeOfMonth(year, monthIdx);
    const start = DateUtil.toYMD(first);
    const end = DateUtil.toYMD(last);
    return new Promise((resolve, reject) => {
      tx(['dayFlags'], 'readonly', (dayFlags) => {
        const out = {};
        const req = dayFlags.openCursor();
        req.onsuccess = () => {
          const cursor = req.result;
          if(cursor){
            const rec = cursor.value;
            if(rec.date >= start && rec.date <= end){ out[rec.date] = rec; }
            cursor.continue();
          } else resolve(out);
        };
      }).catch(reject);
    });
  }
};

/*************************
 * Auth (localStorage)
 *************************/
const USER_KEY = 'ts_user';
const SESSION_KEY = 'ts_session';
function getUser(){
  const raw = localStorage.getItem(USER_KEY);
  if(!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function setUser(u){ localStorage.setItem(USER_KEY, JSON.stringify(u)); }
function getSession(){
  const raw = sessionStorage.getItem(SESSION_KEY);
  if(!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
function setSession(s){ sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); }
function clearSession(){ sessionStorage.removeItem(SESSION_KEY); }

/*************************
 * Components
 *************************/
function App(){
  const [session, setSessionState] = useState(getSession());
  const user = getUser();
  const [theme, setTheme] = useState(() => localStorage.getItem('ts_theme') || 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('ts_theme', theme);
  }, [theme]);

  const handleLoggedIn = (userId) => {
    const s = { userId, at: Date.now() };
    setSession(s);
    setSessionState(s);
  };

  if(!user){ return <Register onRegistered={handleLoggedIn} />; }
  if(!session){ return <Login onLoggedIn={handleLoggedIn} />; }
  return <Main theme={theme} setTheme={setTheme} onLogout={() => { clearSession(); setSessionState(null); }} />;
}

function Register({ onRegistered }){
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const register = async (e) => {
    e.preventDefault();
    if(!userId.trim() || !pin.trim()) return alert('Please enter ID and PIN');
    if(pin !== confirm) return alert('PIN and Confirm PIN must match');
    setBusy(true);
    const salt = crypto.randomUUID();
    const pinHash = await sha256Hex(pin + ':' + salt);
    setUser({ userId, salt, pinHash, createdAt: new Date().toISOString() });
    onRegistered(userId);
  };

  return (
    <div className="auth">
      <h1>Create your Tiffin Tracker</h1>
      <p className="help">Set a unique ID and a PIN to secure your tiffin records on this device. Everything stays locally in your browser.</p>
      <form onSubmit={register}>
        <div className="form-row">
          <div>
            <label>ID</label>
            <input className="input" value={userId} onChange={e=>setUserId(e.target.value)} placeholder="e.g. gurinder" />
          </div>
          <div>
            <label>PIN</label>
            <input className="input" type="password" inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value)} placeholder="4-6 digits" />
          </div>
        </div>
        <div className="form-row" style={{ marginTop: 10 }}>
          <div>
            <label>Confirm PIN</label>
            <input className="input" type="password" inputMode="numeric" value={confirm} onChange={e=>setConfirm(e.target.value)} placeholder="repeat PIN" />
          </div>
          <div style={{ display:'flex', alignItems:'end' }}>
            <button className="button" disabled={busy} type="submit">Create</button>
          </div>
        </div>
      </form>
      <p className="help" style={{ marginTop:12 }}>Already have an account on this device? Reload after deleting `localStorage` key <span className="kbd">ts_user</span> to re-register.</p>
    </div>
  );
}

function Login({ onLoggedIn }){
  const [userId, setUserId] = useState('');
  const [pin, setPin] = useState('');
  const user = getUser();

  const login = async (e) => {
    e.preventDefault();
    if(!user) return alert('No user registered on this device');
    if(userId !== user.userId) return alert('Wrong ID');
    const attempt = await sha256Hex(pin + ':' + user.salt);
    if(attempt !== user.pinHash) return alert('Wrong PIN');
    onLoggedIn(user.userId);
  };

  return (
    <div className="auth">
      <h1>Welcome back</h1>
      <form onSubmit={login}>
        <div className="form-row">
          <div>
            <label>ID</label>
            <input className="input" value={userId} onChange={e=>setUserId(e.target.value)} placeholder="your ID" />
          </div>
          <div>
            <label>PIN</label>
            <input className="input" type="password" inputMode="numeric" value={pin} onChange={e=>setPin(e.target.value)} placeholder="your PIN" />
          </div>
        </div>
        <div style={{ marginTop: 10, display:'flex', justifyContent:'flex-end' }}>
          <button className="button" type="submit">Enter</button>
        </div>
      </form>
      <p className="help" style={{ marginTop:12 }}>Your data stays on this device in <span className="kbd">IndexedDB</span> and <span className="kbd">localStorage</span>.</p>
    </div>
  );
}

function Main({ onLogout, theme, setTheme }){
  const [today] = useState(DateUtil.toYMD(new Date()));
  const [selectedDate, setSelectedDate] = useState(today);
  const d = DateUtil.parseYMD(selectedDate);
  const [year, monthIdx] = [d.getFullYear(), d.getMonth()];

  const [monthStats, setMonthStats] = useState({});
  const [dayOrders, setDayOrders] = useState([]);
  const [dayMissed, setDayMissed] = useState(false);
  const [showBulkPay, setShowBulkPay] = useState(false);
  const [selectedDates, setSelectedDates] = useState([]);

  const refreshMonth = useCallback(async () => {
    const all = await OrdersRepo.all();
    const flags = await DayFlagsRepo.listForMonth(year, monthIdx);
    const monthKey = DateUtil.monthKey(new Date(year, monthIdx, 1));
    const stats = {};
    for(const o of all){
      if(o.date.startsWith(monthKey)){
        stats[o.date] ||= { orderCount:0, paidCount:0, missed:false };
        stats[o.date].orderCount++;
        if(o.paid) stats[o.date].paidCount++;
      }
    }
    for(const date in flags){
      stats[date] ||= { orderCount:0, paidCount:0, missed:false };
      stats[date].missed = !!flags[date].missed;
    }
    setMonthStats(stats);
  }, [year, monthIdx]);

  const refreshDay = useCallback(async () => {
    const [orders, flag] = await Promise.all([
      OrdersRepo.byDate(selectedDate),
      DayFlagsRepo.get(selectedDate)
    ]);
    // newest first
    setDayOrders(orders.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)));
    setDayMissed(!!flag.missed);
  }, [selectedDate]);

  useEffect(() => { refreshMonth(); }, [refreshMonth]);
  useEffect(() => { refreshDay(); }, [refreshDay]);
  // Clear selected date checkboxes when month view changes
  useEffect(() => { setSelectedDates([]); }, [year, monthIdx]);

  const goPrevMonth = () => setSelectedDate(DateUtil.toYMD(new Date(year, monthIdx-1, 1)));
  const goNextMonth = () => setSelectedDate(DateUtil.toYMD(new Date(year, monthIdx+1, 1)));

  const toggleDateSelected = (ymd) => {
    setSelectedDates(ds => ds.includes(ymd) ? ds.filter(x=>x!==ymd) : [...ds, ymd]);
  };

  return (
    <div className="container">
      <header className="app-header">
        <div className="brand">
          <div className="logo" />
          <div>
            <h1>Tiffin Tracker</h1>
            <div className="subtitle">Daily orders, missed days, and payments</div>
          </div>
        </div>
        <div className="header-actions">
          <span className="kbd">{DateUtil.toYMD(new Date())}</span>
          <button className="button secondary" onClick={()=> setTheme(theme === 'dark' ? 'light' : 'dark')}>
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
          <button className="button" disabled={selectedDates.length===0} onClick={()=> setShowBulkPay(true)}>
            Bulk Pay{selectedDates.length>0 ? ` (${selectedDates.length})` : ''}
          </button>
          <button className="button secondary" onClick={onLogout}>Logout</button>
        </div>
      </header>

      <div className="layout">
        <section className="card calendar">
          <div className="month-bar">
            <div className="controls">
              <button className="button secondary" onClick={goPrevMonth}>← Prev</button>
              <div className="month-title">{DateUtil.monthName(year, monthIdx)}</div>
              <button className="button secondary" onClick={goNextMonth}>Next →</button>
            </div>
            <input type="month" className="input" value={`${year}-${String(monthIdx+1).padStart(2,'0')}`} onChange={e=>{
              const [y, m] = e.target.value.split('-').map(Number);
              setSelectedDate(DateUtil.toYMD(new Date(y, m-1, 1)));
            }} />
          </div>
          <div className="month-grid">
            {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map(w => <div key={w} className="weekday">{w}</div>)}
            {DateUtil.getMonthMatrix(year, monthIdx).map((dt, idx) => {
              if(!dt) return <div key={idx} className="day" style={{ opacity:0.4 }} />;
              const ymd = DateUtil.toYMD(dt);
              const s = monthStats[ymd] || { orderCount:0, paidCount:0, missed:false };
              return (
                <div key={ymd} className="day">
                  <header>
                    <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                      <div>{dt.getDate()}</div>
                      {s.orderCount>0 && (
                        <input
                          title="Select date for bulk pay"
                          type="checkbox"
                          checked={selectedDates.includes(ymd)}
                          onChange={()=> toggleDateSelected(ymd)}
                          style={{ margin:0 }}
                        />
                      )}
                    </div>
                    <div className="counts">
                      {s.orderCount>0 && <span className="badge orders">{s.orderCount} orders</span>}
                      {s.paidCount>0 && <span className="badge paid">{s.paidCount} paid</span>}
                      {s.missed && <span className="badge missed">missed</span>}
                    </div>
                  </header>
                  <button className="button" onClick={()=>setSelectedDate(ymd)}>Open</button>
                </div>
              );
            })}
          </div>
        </section>

        <DayDetail
          selectedDate={selectedDate}
          orders={dayOrders}
          missed={dayMissed}
          onChanged={() => { refreshDay(); refreshMonth(); }}
          onChangeSelectedDate={setSelectedDate}
        />
      </div>

      <div className="footer">Made with ❤️ — data stays on this device.</div>

      {showBulkPay && (
        <BulkPayModal
          dates={selectedDates}
          onClose={()=> setShowBulkPay(false)}
          onDone={()=> { setShowBulkPay(false); setSelectedDates([]); refreshDay(); refreshMonth(); }}
        />
      )}
    </div>
  );
}

function DayDetail({ selectedDate, orders, missed, onChanged, onChangeSelectedDate }){
  const [title, setTitle] = useState('Tiffin');
  const [quantity, setQuantity] = useState(1);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);

  const [selectedIds, setSelectedIds] = useState([]);
  const fileInputRef = useRef(null);

  const toggleMissed = async () => {
    await DayFlagsRepo.setMissed(selectedDate, !missed);
    onChanged();
  };

  const addOrder = async (e) => {
    e.preventDefault();
    setBusy(true);
    try{
      const order = {
        id: crypto.randomUUID(),
        date: selectedDate,
        title: title.trim() || 'Tiffin',
        quantity: Number(quantity) || 1,
        notes: notes.trim(),
        paid: false,
        evidenceId: null,
        createdAt: new Date().toISOString()
      };
      await OrdersRepo.add(order);
      setNotes('');
      setQuantity(1);
      onChanged();
    } finally { setBusy(false); }
  };

  const toggleSelect = (id) => {
    setSelectedIds(ids => ids.includes(id) ? ids.filter(x=>x!==id) : [...ids, id]);
  };

  const markSelectedPaid = async (file) => {
    if(selectedIds.length === 0) return alert('Select at least one order');
    if(!file) return;
    const blob = file;
    const evidenceId = await EvidenceRepo.save(blob);
    await OrdersRepo.bulkUpdate(selectedIds, (o) => ({ ...o, paid: true, paidAt: new Date().toISOString(), evidenceId }));
    setSelectedIds([]);
    onChanged();
  };

  const deleteOrder = async (id) => {
    if(!confirm('Delete this order?')) return;
    await OrdersRepo.delete(id);
    onChanged();
  };

  return (
    <section className="card">
      <h2>Day details • <span className="kbd">{selectedDate}</span></h2>

      <div className="controls" style={{ marginBottom: 10 }}>
        <button className={classNames('button', missed ? 'danger' : 'secondary')} onClick={toggleMissed}>
          {missed ? 'Unmark missed' : 'Mark day as missed'}
        </button>
        <input type="date" className="input" value={selectedDate} onChange={e=> onChangeSelectedDate?.(e.target.value)} />
        <button className="button secondary" onClick={()=>{
          const v = prompt('Jump to date (YYYY-MM-DD)', selectedDate);
          if(v){
            const d = new Date(v);
            if(!isNaN(d)){
              const ymd = DateUtil.toYMD(d);
              onChangeSelectedDate?.(ymd);
            }
          }
        }}>Jump</button>
      </div>

      <form onSubmit={addOrder}>
        <div className="form-row">
          <div>
            <label>Item</label>
            <input className="input" value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Veg Thali" />
          </div>
          <div>
            <label>Quantity</label>
            <input className="input" type="number" min="1" value={quantity} onChange={e=>setQuantity(e.target.value)} />
          </div>
        </div>
        <div className="form-row" style={{ marginTop: 10 }}>
          <div>
            <label>Notes</label>
            <input className="input" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="spice level, delivery notes..." />
          </div>
          <div style={{ display:'flex', alignItems:'end' }}>
            <button className="button success" disabled={busy} type="submit">Add order</button>
          </div>
        </div>
      </form>

      <div className="controls" style={{ marginTop: 12 }}>
        <input ref={fileInputRef} onChange={e=> markSelectedPaid(e.target.files[0])} type="file" accept="image/*" style={{ display:'none' }} />
        <button className="button" onClick={()=> fileInputRef.current && fileInputRef.current.click()} disabled={selectedIds.length===0}>Mark selected as Paid + upload screenshot</button>
      </div>

      <div className="order-list">
        {orders.length === 0 && !missed && <div className="help">No orders for this day yet.</div>}
        {orders.map(o => <OrderRow key={o.id} order={o} selected={selectedIds.includes(o.id)} onToggleSelect={()=>toggleSelect(o.id)} onDelete={()=>deleteOrder(o.id)} onTogglePaid={async()=>{
          await OrdersRepo.update({ ...o, paid: !o.paid, paidAt: !o.paid ? new Date().toISOString() : null });
          onChanged();
        }} />)}
      </div>
    </section>
  );
}

function BulkPayModal({ onClose, onDone, dates = [] }){
  const fileRef = useRef(null);
  const [count, setCount] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const os = await OrdersRepo.byDates(dates);
      setCount(os.filter(o=>!o.paid).length);
    })();
  }, [dates.join('|')]);

  const submit = async () => {
    if(!fileRef.current?.files?.[0]) return alert('Please choose a screenshot image');
    setBusy(true);
    try{
      const os = await OrdersRepo.byDates(dates);
      const targets = os.filter(o=>!o.paid).map(o=>o.id);
      if(targets.length === 0) { alert('No unpaid orders in range'); return; }
      const evidenceId = await EvidenceRepo.save(fileRef.current.files[0]);
      await OrdersRepo.bulkUpdate(targets, (o) => ({ ...o, paid: true, paidAt: new Date().toISOString(), evidenceId }));
      onDone();
    } finally { setBusy(false); }
  };

  return (
    <div className="modal-backdrop" onClick={(e)=> { if(e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <header>
          <h3>Bulk Pay</h3>
          <button className="button secondary" onClick={onClose}>Close</button>
        </header>
        <div className="selected-dates help">Selected dates: {dates.length ? dates.join(', ') : 'none'}</div>
        <div style={{ marginTop: 10 }}>
          <label>Screenshot</label>
          <input ref={fileRef} className="input" type="file" accept="image/*" />
        </div>
        <div className="actions">
          <div className="help">Unpaid orders across selected dates: <strong>{count}</strong></div>
          <button className="button success" disabled={busy} onClick={submit}>Mark all as Paid</button>
        </div>
      </div>
    </div>
  );
}

function useEvidenceUrl(evidenceId){
  const [url, setUrl] = useState(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if(!evidenceId){ setUrl(null); return; }
      const rec = await EvidenceRepo.get(evidenceId);
      if(!rec || !rec.blob) { setUrl(null); return; }
      const objectUrl = URL.createObjectURL(rec.blob);
      if(alive) setUrl(objectUrl);
      return () => URL.revokeObjectURL(objectUrl);
    })();
    return () => { alive = false; };
  }, [evidenceId]);
  return url;
}

function OrderRow({ order, selected, onToggleSelect, onDelete, onTogglePaid }){
  const url = useEvidenceUrl(order.evidenceId);
  return (
    <div className="order-item">
      <input type="checkbox" checked={selected} onChange={onToggleSelect} />
      <div>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <strong>{order.title}</strong>
          <span className="badge">x{order.quantity}</span>
          {order.paid && <span className="badge paid">Paid</span>}
        </div>
        <div className="meta">{order.notes || '—'} • added {new Date(order.createdAt).toLocaleString()}</div>
        {order.paidAt && <div className="meta">paid {new Date(order.paidAt).toLocaleString()}</div>}
      </div>
      <div style={{ display:'grid', gap:8, justifyItems:'end' }}>
        {url ? <img alt="evidence" className="thumb" src={url} /> : <div className="thumb" style={{ display:'grid', placeItems:'center', color:'var(--muted)', fontSize:10 }}>no proof</div>}
        <div style={{ display:'flex', gap:6 }}>
          <button className="button secondary" onClick={onTogglePaid}>{order.paid ? 'Unpay' : 'Mark Paid'}</button>
          <button className="button danger" onClick={onDelete}>Delete</button>
        </div>
      </div>
    </div>
  );
}

/*************************
 * Mount
 *************************/
const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(<App />);
