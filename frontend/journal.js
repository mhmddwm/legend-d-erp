// --- 1. دوال إدارة الأسطر (للإدخال المتعدد) ---

function addRow() {
    const tbody = document.getElementById('journalLinesBody');
    const newRow = `<tr>
        <td><input type="text" class="acc-input" placeholder="رقم الحساب"></td>
        <td><input type="number" class="debit-input" value="0"></td>
        <td><input type="number" class="credit-input" value="0"></td>
        <td><input type="text" class="desc-input" placeholder="البيان"></td>
        <td><button onclick="removeRow(this)">حذف</button></td>
    </tr>`;
    tbody.insertAdjacentHTML('beforeend', newRow);
}

function removeRow(btn) {
    btn.closest('tr').remove();
}

// --- 2. دالة حفظ وترحيل القيد ---

async function saveJournal() {
    const btn = document.querySelector('.btn-save');
    btn.disabled = true; // منع التكرار

    const rows = document.querySelectorAll('#journalLinesBody tr');
    const lines = [];
    
    rows.forEach(row => {
        lines.push({
            account: row.querySelector('.acc-input').value,
            debit: parseFloat(row.querySelector('.debit-input').value) || 0,
            credit: parseFloat(row.querySelector('.credit-input').value) || 0,
            desc: row.querySelector('.desc-input').value
        });
    });

    const payload = {
        date: document.getElementById('journalDate').value,
        ref: document.getElementById('journalRef').value,
        lines: lines
    };

    try {
        const response = await fetch('/api/save_journal', {
            method: 'POST',
            headers: {'Content-Type': 'application/json'},
            body: JSON.stringify(payload)
        });

        if (response.ok) {
            alert('تم حفظ وترحيل القيد بنجاح');
            // إعادة ضبط الجدول
            document.getElementById('journalLinesBody').innerHTML = `<tr>
                <td><input type="text" class="acc-input" placeholder="رقم الحساب"></td>
                <td><input type="number" class="debit-input" value="0"></td>
                <td><input type="number" class="credit-input" value="0"></td>
                <td><input type="text" class="desc-input" placeholder="البيان"></td>
                <td><button onclick="removeRow(this)">حذف</button></td>
            </tr>`;
            applyFilters(); // تحديث جدول العرض تلقائياً
        } else {
            alert('خطأ في الحفظ');
        }
    } catch (e) {
        alert('حدث خطأ في الاتصال');
    } finally {
        btn.disabled = false;
    }
}

// --- 3. دوال البحث والعرض ---

async function applyFilters() {
    // تجميع القيم من حقول البحث
    const filters = new URLSearchParams({
        entry_no: document.getElementById('filterEntryNo').value || '',
        account: document.getElementById('filterAccount')?.value || '',
        user: document.getElementById('filterUser')?.value || '',
        date_from: document.getElementById('dateFrom')?.value || '',
        date_to: document.getElementById('dateTo')?.value || '',
        amount_min: document.getElementById('amountMin')?.value || '',
        amount_max: document.getElementById('amountMax')?.value || ''
    });

    const response = await fetch(`/api/journal?${filters.toString()}`);
    const data = await response.json();

    updateJournalTable(data);
}

function updateJournalTable(data) {
    const tableBody = document.getElementById('journalTableBody');
    tableBody.innerHTML = ''; 

    data.forEach(entry => {
        tableBody.innerHTML += `
            <tr>
                <td>${entry.id}</td>
                <td>${entry.entry_date}</td>
                <td>${entry.debit_account || '-'}</td>
                <td>${entry.credit_account || '-'}</td>
                <td>${entry.amount}</td>
                <td>${entry.description}</td>
            </tr>
        `;
    });
}