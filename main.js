const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage } = require('electron');
const path = require('path');
const fetch = require('node-fetch');

let tray = null;
let mainWindow = null;
let loginWindow = null;

const API_ENDPOINTS = {
  EU: {
    auth: 'https://api-eu.libreview.io/llu/auth/login',
    data: 'https://api-eu.libreview.io/llu/connections'
  },
  US: {
    auth: 'https://api.libreview.io/llu/auth/login',
    data: 'https://api.libreview.io/llu/connections'
  }
};

let credentials = null;
let updateInterval = null;

function createMainWindow() {
  console.log('Creating the main window'); // Log when main window is created
  
  // Create the main window with specific options
  mainWindow = new BrowserWindow({
    width: 300,
    height: 200,
    show: false,
    frame: false,
    fullscreenable: false,
    resizable: false,
    transparent: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWindow.loadFile('index.html'); // Load the main HTML file

  // Event listener for when the main window loses focus
  mainWindow.on('blur', () => {
    console.log('Main window blurred'); // Log when the main window loses focus
    if (!mainWindow.webContents.isDevToolsOpened()) {
      mainWindow.hide(); // Hide the window if the developer tools are not open
    }
  });
}

function createLoginWindow() {
  console.log('Creating the login window'); // Log when login window is created
  
  // Create the login window with specific options
  loginWindow = new BrowserWindow({
    width: 300,
    height: 400,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  loginWindow.loadFile('login.html'); // Load the login HTML file
}

function createTray() {
  console.log('Creating the tray icon'); // Log when tray icon is created
  
  // Create the system tray with an icon
  tray = new Tray(path.join(__dirname, 'icon.png'));
  tray.setToolTip('Glucose Monitor'); // Set tooltip for tray icon

  // Event listener for when the tray icon is clicked
  tray.on('click', (event, bounds) => {
    console.log('Tray icon clicked'); // Log when the tray icon is clicked
    
    const { x, y } = bounds;
    const { height, width } = mainWindow.getBounds();
    const yPosition = process.platform !== 'darwin' ? y - height : y;

    // Set the position of the main window relative to the tray icon click
    mainWindow.setBounds({
      x: x - width / 2,
      y: yPosition,
      height,
      width
    });

    // Show main window or login window based on whether credentials exist
    if (credentials) {
      mainWindow.show();
      updateGlucoseLevel();
    } else {
      createLoginWindow();
    }
  });
}

// Electron's 'ready' event to set up windows and tray icon when the app is ready
app.whenReady().then(() => {
  console.log('App is ready'); // Log when the app is ready
  createMainWindow();
  createTray();

  // Re-create the main window if all windows are closed but the app is still running (macOS)
  app.on('activate', () => {
    console.log('App activated'); // Log when the app is activated
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

// Close the app completely when all windows are closed (except on macOS)
app.on('window-all-closed', () => {
  console.log('All windows closed'); // Log when all windows are closed
  if (process.platform !== 'darwin') app.quit();
});

// Function to authenticate the user by sending credentials to the API
async function authenticateUser({ email, password, region }) {
  console.log('Authenticating user', email); // Log when authentication starts
  
  const response = await fetch(API_ENDPOINTS[region].auth, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'product': 'llu.android',
      'version': '4.7.1'
    },
    body: JSON.stringify({ email, password })
  });
  
  const data = await response.json();
  console.log('Authentication response:', data); // Log the authentication response
  
  if (data.status !== 0) {
    throw new Error(data.error?.message || 'Authentication failed'); // Handle authentication errors
  }
  
  return data.data.authTicket.token; // Return the token if authentication succeeds
}

// Function to fetch glucose data using the provided token
async function fetchGlucoseData(token, region) {
  console.log('Fetching glucose data'); // Log when fetching glucose data starts
  
  const response = await fetch(API_ENDPOINTS[region].data, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'product': 'llu.android',
      'version': '4.7.1'
    }
  });
  
  if (!response.ok) {
    console.log('Error fetching glucose data', response.status, response.statusText); // Log errors during data fetching
    throw new Error(`Failed to fetch glucose data: ${response.status} ${response.statusText}`);
  }

  const data = await response.json();
  console.log('Glucose data response:', data); // Log the glucose data response
  
  if (!data.data || data.data.length === 0 || !data.data[0].glucoseMeasurement) {
    throw new Error('No glucose data available in the response');
  }

  return data.data[0].glucoseMeasurement; // Return the glucose measurement
}

// Function to update the glucose level in the main window
async function updateGlucoseLevel() {
  console.log('Updating glucose level'); // Log when updating glucose level
  
  try {
    const token = await authenticateUser(credentials); // Authenticate user to get token
    const glucoseData = await fetchGlucoseData(token, credentials.region); // Fetch glucose data using token
    console.log('Sending glucose data to main window:', glucoseData); // Log the glucose data being sent to the main window
    mainWindow.webContents.send('updateGlucose', glucoseData); // Send the data to the renderer process
  } catch (error) {
    console.error('Error fetching glucose data:', error); // Log any errors
    mainWindow.webContents.send('updateGlucose', { error: error.message }); // Send error to the renderer process
  }
}

// IPC event listener for login events
ipcMain.on('login', async (event, loginData) => {
  console.log('Login event received'); // Log when login event is received
  try {
    await authenticateUser(loginData); // Authenticate the user with the login data
    credentials = loginData; // Store credentials for future use
    loginWindow.close(); // Close the login window
    mainWindow.show(); // Show the main window
    updateGlucoseLevel(); // Update the glucose level
    startPeriodicUpdate(); // Start the periodic update
  } catch (error) {
    console.log('Login failed:', error.message); // Log login failure
    event.reply('loginError', error.message); // Reply with the login error message
  }
});

// Function to start periodic glucose data updates
function startPeriodicUpdate() {
  console.log('Starting periodic update'); // Log when starting the periodic update
  
  if (updateInterval) {
    clearInterval(updateInterval); // Clear any existing intervals
  }
  
  // Set interval to update glucose data every minute
  updateInterval = setInterval(() => {
    if (credentials) {
      console.log('Periodic update: Updating glucose level'); // Log each periodic update
      updateGlucoseLevel();
    }
  }, 60000); // Update every minute
}

// IPC event listener to update the tray icon with new image data
ipcMain.on('updateTrayIcon', (event, dataUrl) => {
  console.log('Updating tray icon'); // Log when the tray icon is updated
  const image = nativeImage.createFromDataURL(dataUrl);
  tray.setImage(image); // Set the new image for the tray icon
});
