// Google Drive Backup & Restore Handler (Pre-configured with your Client ID)
const CLIENT_ID = '637986414370-kn5c03tcdl0vj9amsrndt0kpmoueg7u7.apps.googleusercontent.com'; 
const SCOPES = 'https://www.googleapis.com/auth/drive.file';

let tokenClient = null;

function initGoogleDrive() {
    if (typeof google !== 'undefined' && google.accounts) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: '',
        });
    }
}

// 1. Backup Function
async function startGoogleBackup() {
    const statusEl = document.getElementById('syncStatus');
    statusEl.innerText = "Google Drive se connect ho raha hai...";

    getToken((accessToken) => {
        if (!accessToken) {
            statusEl.innerText = "Authentication fail ho gayi!";
            return;
        }

        statusEl.innerText = "Data tayar kiya ja raha hai...";
        
        const storeData = {
            shopName: "RAMZAN ELECTRIC STORE & HARDWARE",
            backupTime: new Date().toISOString(),
            items: JSON.parse(localStorage.getItem('shop_items') || localStorage.getItem('items') || '[]'),
            sales: JSON.parse(localStorage.getItem('shop_sales') || localStorage.getItem('sales') || '[]'),
            rentals: JSON.parse(localStorage.getItem('shop_rentals') || localStorage.getItem('rentals') || '[]'),
            customers: JSON.parse(localStorage.getItem('shop_customers') || localStorage.getItem('customers') || '[]')
        };

        const fileContent = JSON.stringify(storeData, null, 2);
        const file = new Blob([fileContent], { type: 'application/json' });
        
        findExistingFile(accessToken, async (fileId) => {
            const metadata = {
                name: 'ramzan_store_backup.json',
                mimeType: 'application/json',
            };

            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', file);

            let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart';
            let method = 'POST';

            if (fileId) {
                url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`;
                method = 'PATCH';
            }

            try {
                const response = await fetch(url, {
                    method: method,
                    headers: new Headers({ 'Authorization': 'Bearer ' + accessToken }),
                    body: form,
                });

                if (response.ok) {
                    statusEl.style.color = 'green';
                    statusEl.innerText = "Backup Successful! Data Google Drive par save ho gaya hai.";
                } else {
                    statusEl.style.color = 'red';
                    statusEl.innerText = "Backup upload me fail ho gaya.";
                }
            } catch (e) {
                statusEl.style.color = 'red';
                statusEl.innerText = "Error: " + e.message;
            }
        });
    });
}

// 2. Restore Function
async function startGoogleRestore() {
    const statusEl = document.getElementById('syncStatus');
    statusEl.innerText = "Google Drive se connect ho raha hai...";

    getToken((accessToken) => {
        if (!accessToken) {
            statusEl.innerText = "Authentication fail ho gayi!";
            return;
        }

        statusEl.innerText = "Backup file talash ki ja rahi hai...";
        findExistingFile(accessToken, async (fileId) => {
            if (!fileId) {
                statusEl.style.color = 'red';
                statusEl.innerText = "Google Drive par koi backup file nahi mili!";
                return;
            }

            try {
                statusEl.innerText = "Backup data download ho raha hai...";
                const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                    headers: new Headers({ 'Authorization': 'Bearer ' + accessToken })
                });

                if (response.ok) {
                    const data = await response.json();
                    
                    if (data.items) localStorage.setItem('shop_items', JSON.stringify(data.items));
                    if (data.sales) localStorage.setItem('shop_sales', JSON.stringify(data.sales));
                    if (data.rentals) localStorage.setItem('shop_rentals', JSON.stringify(data.rentals));
                    if (data.customers) localStorage.setItem('shop_customers', JSON.stringify(data.customers));

                    statusEl.style.color = 'green';
                    statusEl.innerText = "Restore Successful! App refresh ho rahi hai...";
                    setTimeout(() => location.reload(), 1500);
                } else {
                    statusEl.style.color = 'red';
                    statusEl.innerText = "Backup file download nahi ho saki.";
                }
            } catch (e) {
                statusEl.style.color = 'red';
                statusEl.innerText = "Error: " + e.message;
            }
        });
    });
}

function getToken(callback) {
    if (!tokenClient) {
        initGoogleDrive();
    }
    if (!tokenClient) {
        alert("Google API script load nahi ho saki.");
        return;
    }
    tokenClient.callback = async (resp) => {
        if (resp.error !== undefined) {
            callback(null);
            return;
        }
        callback(resp.access_token);
    };
    tokenClient.requestAccessToken({ prompt: '' });
}

async function findExistingFile(accessToken, callback) {
    try {
        const query = encodeURIComponent("name = 'ramzan_store_backup.json' and trashed = false");
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${query}`, {
            headers: new Headers({ 'Authorization': 'Bearer ' + accessToken })
        });
        const result = await res.json();
        if (result.files && result.files.length > 0) {
            callback(result.files[0].id);
        } else {
            callback(null);
        }
    } catch (e) {
        callback(null);
    }
}

window.addEventListener('load', () => {
    if (typeof google === 'undefined') {
        const script = document.createElement('script');
        script.src = "https://accounts.google.com/gsi/client";
        script.async = true;
        script.defer = true;
        script.onload = initGoogleDrive;
        document.head.appendChild(script);
    } else {
        initGoogleDrive();
    }
});
// Automatically add Google Drive buttons to the app screen
window.addEventListener('DOMContentLoaded', () => {
    setTimeout(() => {
        if (!document.getElementById('btnGoogleBackup')) {
            const container = document.createElement('div');
            container.style.cssText = "text-align: center; margin: 15px; padding: 10px; background: #fff; border-radius: 8px;";
            container.innerHTML = `
                <button onclick="startGoogleBackup()" style="background: #4285F4; color: white; padding: 10px 15px; border: none; border-radius: 5px; font-weight: bold; cursor: pointer; margin-right: 5px;">Backup to Drive</button>
                <button onclick="startGoogleRestore()" style="background: #34A853; color: white; padding: 10px 15px; border: none; border-radius: 5px; font-weight: bold; cursor: pointer;">Restore from Drive</button>
                <p id="syncStatus" style="font-size: 12px; margin-top: 5px; font-weight: bold;"></p>
            `;
            const target = document.querySelector('#app') || document.body;
            target.insertBefore(container, target.firstChild);
        }
    }, 1000);
});
