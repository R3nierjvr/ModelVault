// ModelVault.exe: the ModelVault icon next to the Windows clock (the notification area).
//
// It starts ModelVault in the background with "Start ModelVault.cmd" (which reads settings.cmd, writes the log
// and restarts ModelVault after updates), shows whether it's running, and its menu can open, start, stop and
// restart ModelVault, show the log, switch "Start with Windows" on or off, show About, and quit.
// Built by tools/build-windows.sh with Mono's C# compiler; runs on the .NET Framework 4 that comes with Windows.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;
using System.Net;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Windows.Forms;

namespace ModelVault
{
    static class Program
    {
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();

        [STAThread]
        static void Main(string[] args)
        {
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string dir = AppDomain.CurrentDomain.BaseDirectory.TrimEnd('\\');
            bool background = false;
            foreach (string a in args) if (a.Equals("/background", StringComparison.OrdinalIgnoreCase)) background = true;

            // One icon per ModelVault folder. Starting it again (Start menu, desktop) opens ModelVault instead.
            string id = Fnv(dir.ToLowerInvariant());
            bool first;
            Mutex mutex = new Mutex(true, @"Local\ModelVaultTray-" + id, out first);
            EventWaitHandle openSignal = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\ModelVaultTrayOpen-" + id);
            if (!first)
            {
                if (!background) openSignal.Set();
                return;
            }
            Tray tray = new Tray(dir, background);
            ThreadPool.RegisterWaitForSingleObject(openSignal, delegate { tray.OnUi(tray.OpenModelVault); }, null, -1, false);
            Application.ThreadException += delegate (object s, ThreadExceptionEventArgs e) { tray.LogTrayError(e.Exception); };
            Application.Run(tray);
            GC.KeepAlive(mutex);
        }

        static string Fnv(string s)
        {
            uint h = 2166136261;
            foreach (char c in s) { h ^= c; h *= 16777619; }
            return h.ToString("x8");
        }
    }

    /// <summary>The values settings.cmd sets, read the same way "Start ModelVault.cmd" reads them.</summary>
    class Config
    {
        public string Port = "8420";
        public string DataDir;
        public bool OpenBrowser = true;
        public string Url { get { return "http://localhost:" + Port; } }
        public string LogFile { get { return Path.Combine(Path.Combine(DataDir, "logs"), "ModelVault.log"); } }

        static readonly Regex SetLine = new Regex("^\\s*set\\s+\"([^=\"]+)=(.*)\"\\s*$", RegexOptions.IgnoreCase);
        static readonly Regex Var = new Regex("%([A-Za-z0-9_]+)%");

        public static Config Load(string dir)
        {
            Dictionary<string, string> vars = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            Read(Path.Combine(dir, "settings.cmd"), vars);
            string local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
            Read(Path.Combine(Path.Combine(local, "ModelVault"), "settings.cmd"), vars);
            Config c = new Config();
            string v;
            if (vars.TryGetValue("PORT", out v) && Regex.IsMatch(v.Trim(), "^[0-9]+$")) c.Port = v.Trim();
            c.DataDir = vars.TryGetValue("DATA_DIR", out v) && v.Trim() != "" ? v.Trim() : Path.Combine(dir, "data");
            if (vars.TryGetValue("OPEN_BROWSER", out v)) c.OpenBrowser = v.Trim() != "0";
            return c;
        }

        public static void Read(string file, Dictionary<string, string> vars)
        {
            if (!File.Exists(file)) return;
            string here = Path.GetDirectoryName(Path.GetFullPath(file)) + "\\";
            foreach (string raw in File.ReadAllLines(file))
            {
                string line = raw.Trim();
                if (line.StartsWith("@")) line = line.Substring(1).TrimStart();
                if (line.StartsWith("rem", StringComparison.OrdinalIgnoreCase) || line.StartsWith("::")) continue;
                Match m = SetLine.Match(line);
                if (!m.Success) continue;
                string value = m.Groups[2].Value.Replace("%~dp0", here);
                value = Var.Replace(value, delegate (Match x)
                {
                    string name = x.Groups[1].Value, found;
                    if (vars.TryGetValue(name, out found)) return found;
                    string env = Environment.GetEnvironmentVariable(name);
                    return env ?? x.Value;
                });
                vars[m.Groups[1].Value.Trim()] = value;
            }
        }

        /// <summary>The version in app\server\index.js, for when ModelVault isn't running.</summary>
        public static string InstalledVersion(string dir)
        {
            try
            {
                string js = File.ReadAllText(Path.Combine(dir, @"app\server\index.js"));
                Match m = Regex.Match(js, "const VERSION = '([^']+)'");
                return m.Success ? m.Groups[1].Value : "";
            }
            catch { return ""; }
        }
    }

    enum State { Starting, Running, Stopping, Stopped }

    class Tray : ApplicationContext
    {
        readonly string dir;
        Config cfg;
        readonly NotifyIcon icon;
        readonly ContextMenuStrip menu;
        readonly Control ui;
        readonly Icon iconOn, iconOff, iconBig;
        readonly System.Windows.Forms.Timer timer;
        ToolStripMenuItem miOpen, miStatus, miStart, miStop, miRestart, miLog, miStartup, miAbout, miQuit;

        Process server;            // "Start ModelVault.cmd", when this icon started it
        volatile bool stopping;    // a stop (or quit) asked for here is running
        bool stopAsked;            // ModelVault was stopped from here, so stopping isn't a surprise
        bool alive;                // ModelVault answered the last check
        string version = "";
        string pendingOpen;        // open this page once ModelVault answers
        bool polling;
        DateTime lastOpen = DateTime.MinValue;
        string balloonAction;      // what clicking the last balloon does
        AboutForm about;
        State shown = (State)(-1);

        public Tray(string dir, bool background)
        {
            this.dir = dir;
            cfg = Config.Load(dir);
            version = Config.InstalledVersion(dir);
            ui = new Control();
            ui.CreateControl();

            Size small = SystemInformation.SmallIconSize;
            iconOn = LoadIcon(small);
            iconOff = Grey(iconOn);
            iconBig = LoadIcon(new Size(48, 48));

            menu = new ContextMenuStrip();
            miOpen = Item("Open ModelVault", delegate { OpenModelVault(); });
            miOpen.Font = new Font(miOpen.Font, FontStyle.Bold);
            miStatus = new ToolStripMenuItem("") { Enabled = false };
            miStart = Item("Start ModelVault", delegate { Start(); });
            miStop = Item("Stop ModelVault", delegate { Stop(null); });
            miRestart = Item("Restart ModelVault", delegate { Stop(delegate { Start(); }); });
            miLog = Item("View log", delegate { ViewLog(); });
            miStartup = Item("Start with Windows", delegate { ToggleStartup(); });
            miAbout = Item("About ModelVault", delegate { ShowAbout(); });
            miQuit = Item("Quit", delegate { Quit(); });
            menu.Items.AddRange(new ToolStripItem[] {
                miOpen, miStatus, new ToolStripSeparator(),
                miStart, miStop, miRestart, new ToolStripSeparator(),
                miLog, miStartup, miAbout, new ToolStripSeparator(),
                miQuit });
            menu.Opening += delegate { cfg = Config.Load(dir); Refresh(); miStartup.Checked = File.Exists(StartupLink); };

            icon = new NotifyIcon { Icon = iconOff, Text = "ModelVault", ContextMenuStrip = menu, Visible = true };
            icon.MouseClick += delegate (object s, MouseEventArgs e) { if (e.Button == MouseButtons.Left) OpenModelVault(); };
            icon.BalloonTipClicked += delegate { if (balloonAction == "log") ViewLog(); else if (balloonAction == "open") OpenModelVault(); };

            timer = new System.Windows.Forms.Timer { Interval = 2000 };
            timer.Tick += delegate { Poll(); };
            timer.Start();

            if (!background && cfg.OpenBrowser) pendingOpen = "/";
            Start();
            Refresh();
        }

        ToolStripMenuItem Item(string text, EventHandler click)
        {
            ToolStripMenuItem i = new ToolStripMenuItem(text);
            i.Click += click;
            return i;
        }

        public void OnUi(Action a)
        {
            try { ui.BeginInvoke(a); } catch { }
        }

        string StartupLink
        {
            get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.Startup), "ModelVault.lnk"); }
        }

        State Current
        {
            get
            {
                if (stopping) return State.Stopping;
                if (alive) return State.Running;
                if (server != null && !server.HasExited) return State.Starting;
                return State.Stopped;
            }
        }

        // ---------------- checking whether ModelVault runs ----------------

        /// <summary>Asks ModelVault for /api/ping. Any answer means it runs (older versions answer 404, a login 401).</summary>
        bool Ping(out string ver)
        {
            ver = null;
            try
            {
                HttpWebRequest r = (HttpWebRequest)WebRequest.Create(cfg.Url + "/api/ping");
                r.Proxy = null;
                r.Timeout = 2000;
                r.ReadWriteTimeout = 2000;
                using (HttpWebResponse res = (HttpWebResponse)r.GetResponse())
                using (StreamReader sr = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
                {
                    Match m = Regex.Match(sr.ReadToEnd(), "\"version\"\\s*:\\s*\"([^\"]+)\"");
                    if (m.Success) ver = m.Groups[1].Value;
                }
                return true;
            }
            catch (WebException e)
            {
                if (e.Response != null) { e.Response.Close(); return true; }
                return false;
            }
            catch { return false; }
        }

        void Poll()
        {
            if (polling) return;
            polling = true;
            ThreadPool.QueueUserWorkItem(delegate
            {
                string ver;
                bool ok = Ping(out ver);
                OnUi(delegate
                {
                    polling = false;
                    bool was = alive;
                    alive = ok;
                    if (ok && ver != null) version = ver;
                    if (ok && !was) OnStarted();
                    Refresh();
                });
            });
        }

        void OnStarted()
        {
            if (pendingOpen != null) { string p = pendingOpen; pendingOpen = null; Browse(p); }
            string marker = Path.Combine(cfg.DataDir, "tray-tip-shown");
            if (!File.Exists(marker))
            {
                try { Directory.CreateDirectory(cfg.DataDir); File.WriteAllText(marker, DateTime.Now.ToString("s")); } catch { }
                Balloon("ModelVault is running", "Click this icon to open ModelVault. Right-click it to stop ModelVault, view the log or quit.", ToolTipIcon.Info, "open");
            }
        }

        void Refresh()
        {
            State s = Current;
            string v = version != "" ? " " + version : "";
            string text;
            switch (s)
            {
                case State.Running: text = "Running at " + cfg.Url; break;
                case State.Starting: text = "Starting…"; break;
                case State.Stopping: text = "Stopping…"; break;
                default: text = "Not running"; break;
            }
            miStatus.Text = text;
            miStart.Enabled = s == State.Stopped;
            miStop.Enabled = s == State.Running || s == State.Starting;
            miRestart.Enabled = s == State.Running;
            miQuit.Enabled = s != State.Stopping;
            if (s == shown) return;
            shown = s;
            icon.Icon = s == State.Running ? iconOn : iconOff;
            string tip = "ModelVault" + v + ": " + (s == State.Running ? "running" : s == State.Starting ? "starting…" : s == State.Stopping ? "stopping…" : "not running");
            icon.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
            timer.Interval = s == State.Running || s == State.Stopped ? 4000 : 1000;
            if (about != null && !about.IsDisposed) about.Fill();
        }

        // ---------------- starting and stopping ----------------

        public void Start()
        {
            if (stopping) return;
            string ver;
            if (Ping(out ver)) { alive = true; if (ver != null) version = ver; OnStarted(); Refresh(); return; }
            if (server != null && !server.HasExited) return;
            stopAsked = false;
            cfg = Config.Load(dir);
            string script = Path.Combine(dir, "Start ModelVault.cmd");
            if (!File.Exists(script))
            {
                MessageBox.Show("ModelVault can't find \"Start ModelVault.cmd\" in " + dir + ". Reinstall ModelVault or unzip it again.", "ModelVault", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
            ProcessStartInfo psi = new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe", "/c \"\"" + script + "\"\"");
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WorkingDirectory = dir;
            psi.EnvironmentVariables["MV_HIDDEN"] = "1";
            psi.EnvironmentVariables["MV_BACKGROUND"] = "1"; // this icon opens the browser when ModelVault is ready
            psi.EnvironmentVariables["MV_TRAY"] = "1";
            try
            {
                Process p = Process.Start(psi);
                p.EnableRaisingEvents = true;
                p.Exited += delegate { OnUi(delegate { ServerExited(p); }); };
                server = p;
            }
            catch (Exception e)
            {
                MessageBox.Show("ModelVault couldn't start: " + e.Message, "ModelVault", MessageBoxButtons.OK, MessageBoxIcon.Error);
            }
            Refresh();
        }

        void ServerExited(Process p)
        {
            int code = 0;
            try { code = p.ExitCode; } catch { }
            if (p == server && !stopAsked && !stopping && code != 0)
            {
                alive = false;
                Balloon("ModelVault stopped", "ModelVault stopped unexpectedly. Click here to see the log, or right-click the icon to start it again.", ToolTipIcon.Warning, "log");
            }
            Poll();
        }

        /// <summary>Stops ModelVault with "Stop ModelVault.cmd", then runs <paramref name="then"/>.</summary>
        void Stop(Action then)
        {
            if (stopping) return;
            stopping = true;
            stopAsked = true;
            pendingOpen = null;
            Refresh();
            ThreadPool.QueueUserWorkItem(delegate
            {
                try
                {
                    ProcessStartInfo psi = new ProcessStartInfo(Environment.GetEnvironmentVariable("ComSpec") ?? "cmd.exe", "/c \"\"" + Path.Combine(dir, "Stop ModelVault.cmd") + "\"\"");
                    psi.UseShellExecute = false;
                    psi.CreateNoWindow = true;
                    psi.WorkingDirectory = dir;
                    psi.EnvironmentVariables["MV_QUIET"] = "1";
                    using (Process p = Process.Start(psi)) p.WaitForExit(60000);
                    // Wait until it has really stopped answering (up to 15 seconds).
                    for (int i = 0; i < 30; i++) { string v; if (!Ping(out v)) break; Thread.Sleep(500); }
                }
                catch (Exception e) { LogTrayError(e); }
                OnUi(delegate
                {
                    stopping = false;
                    alive = false;
                    Refresh();
                    if (then != null) then();
                    Poll();
                });
            });
        }

        void Quit()
        {
            Action done = delegate
            {
                timer.Stop();
                icon.Visible = false;
                icon.Dispose();
                if (about != null && !about.IsDisposed) about.Close();
                ExitThread();
            };
            if (Current == State.Stopped) done(); else Stop(done);
        }

        // ---------------- menu actions ----------------

        public void OpenModelVault() { OpenPage("/"); }

        public void OpenPage(string page)
        {
            if (alive) { Browse(page); return; }
            pendingOpen = page;
            if (Current == State.Stopped) Start();
            if (!alive && Current == State.Starting)
                Balloon("ModelVault is starting", "It opens in your browser as soon as it's ready.", ToolTipIcon.Info, null);
        }

        void Browse(string page)
        {
            if (page == "/" && (DateTime.Now - lastOpen).TotalSeconds < 2) return; // a double click opens it once
            lastOpen = DateTime.Now;
            try { Process.Start(new ProcessStartInfo(cfg.Url + page) { UseShellExecute = true }); }
            catch (Exception e) { MessageBox.Show("Windows couldn't open your browser: " + e.Message + "\n\nOpen " + cfg.Url + " yourself.", "ModelVault", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        }

        void ViewLog()
        {
            cfg = Config.Load(dir);
            string log = cfg.LogFile;
            if (!File.Exists(log))
            {
                MessageBox.Show("There's no log yet. ModelVault writes one to\n" + log + "\nwhenever it runs from this icon.", "ModelVault", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            try { Process.Start(new ProcessStartInfo("notepad.exe", "\"" + log + "\"") { UseShellExecute = true }); }
            catch { Process.Start(new ProcessStartInfo(Path.GetDirectoryName(log)) { UseShellExecute = true }); }
        }

        void ToggleStartup()
        {
            string lnk = StartupLink;
            try
            {
                if (File.Exists(lnk)) { File.Delete(lnk); return; }
                Type t = Type.GetTypeFromProgID("WScript.Shell");
                object shell = Activator.CreateInstance(t);
                object sc = t.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { lnk });
                Type st = sc.GetType();
                string exe = Path.Combine(dir, "ModelVault.exe");
                st.InvokeMember("TargetPath", BindingFlags.SetProperty, null, sc, new object[] { exe });
                st.InvokeMember("Arguments", BindingFlags.SetProperty, null, sc, new object[] { "/background" });
                st.InvokeMember("WorkingDirectory", BindingFlags.SetProperty, null, sc, new object[] { dir });
                st.InvokeMember("IconLocation", BindingFlags.SetProperty, null, sc, new object[] { exe + ",0" });
                st.InvokeMember("Description", BindingFlags.SetProperty, null, sc, new object[] { "Starts ModelVault in the background" });
                st.InvokeMember("Save", BindingFlags.InvokeMethod, null, sc, null);
                Marshal.FinalReleaseComObject(sc);
                Marshal.FinalReleaseComObject(shell);
            }
            catch (Exception e)
            {
                MessageBox.Show("Windows didn't let ModelVault change its startup shortcut: " + e.Message, "ModelVault", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            }
        }

        void ShowAbout()
        {
            if (about == null || about.IsDisposed) about = new AboutForm(this);
            about.Fill();
            about.Show();
            about.Activate();
        }

        void Balloon(string title, string text, ToolTipIcon kind, string action)
        {
            balloonAction = action;
            icon.ShowBalloonTip(8000, title, text, kind);
        }

        public void LogTrayError(Exception e)
        {
            try
            {
                string logs = Path.Combine(cfg.DataDir, "logs");
                Directory.CreateDirectory(logs);
                File.AppendAllText(Path.Combine(logs, "tray.log"), DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + e + Environment.NewLine);
            }
            catch { }
        }

        // ---------------- for the About window ----------------

        public string Dir { get { return dir; } }
        public Config Cfg { get { return cfg; } }
        public string Version { get { return version; } }
        public State Status { get { return Current; } }
        public Icon BigIcon { get { return iconBig; } }
        public Icon SmallIcon { get { return iconOn; } }

        // ---------------- icons ----------------

        static Icon LoadIcon(Size size)
        {
            using (Stream s = Assembly.GetExecutingAssembly().GetManifestResourceStream("ModelVault.ico"))
                return s != null ? new Icon(s, size) : SystemIcons.Application;
        }

        /// <summary>The icon in grey, for "not running".</summary>
        static Icon Grey(Icon src)
        {
            using (Bitmap bmp = src.ToBitmap())
            {
                Bitmap g = new Bitmap(bmp.Width, bmp.Height, PixelFormat.Format32bppArgb);
                using (Graphics gr = Graphics.FromImage(g))
                using (ImageAttributes ia = new ImageAttributes())
                {
                    ia.SetColorMatrix(new ColorMatrix(new float[][] {
                        new float[] { .3f, .3f, .3f, 0, 0 },
                        new float[] { .59f, .59f, .59f, 0, 0 },
                        new float[] { .11f, .11f, .11f, 0, 0 },
                        new float[] { 0, 0, 0, .6f, 0 },
                        new float[] { 0, 0, 0, 0, 1 } }));
                    gr.DrawImage(bmp, new Rectangle(0, 0, bmp.Width, bmp.Height), 0, 0, bmp.Width, bmp.Height, GraphicsUnit.Pixel, ia);
                }
                return Icon.FromHandle(g.GetHicon());
            }
        }
    }

    class AboutForm : Form
    {
        readonly Tray tray;
        readonly Label version, status, data, program;

        public AboutForm(Tray tray)
        {
            this.tray = tray;
            Text = "About ModelVault";
            Icon = tray.SmallIcon;
            FormBorderStyle = FormBorderStyle.FixedDialog;
            MaximizeBox = false;
            MinimizeBox = false;
            StartPosition = FormStartPosition.CenterScreen;
            AutoSize = true;
            AutoSizeMode = AutoSizeMode.GrowAndShrink;
            AutoScaleMode = AutoScaleMode.Font;
            Font = SystemFonts.MessageBoxFont;
            Padding = new Padding(16);

            TableLayoutPanel grid = new TableLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 2, Dock = DockStyle.Fill };
            PictureBox pic = new PictureBox { Image = tray.BigIcon.ToBitmap(), SizeMode = PictureBoxSizeMode.AutoSize, Margin = new Padding(0, 0, 16, 0) };
            grid.Controls.Add(pic, 0, 0);
            grid.SetRowSpan(pic, 6);

            Label title = new Label { Text = "ModelVault", AutoSize = true, Font = new Font(Font.FontFamily, Font.Size * 1.6f, FontStyle.Bold), Margin = new Padding(0, 0, 0, 2) };
            version = new Label { AutoSize = true, Margin = new Padding(0, 0, 0, 10) };
            status = new Label { AutoSize = true, Margin = new Padding(0, 0, 0, 10) };
            data = new Label { AutoSize = true, MaximumSize = new Size(460, 0), Margin = new Padding(0, 0, 0, 4) };
            program = new Label { AutoSize = true, MaximumSize = new Size(460, 0), Margin = new Padding(0, 0, 0, 10) };
            Label made = new Label { Text = "Made by V3sper Studios. All rights reserved.", AutoSize = true, ForeColor = SystemColors.GrayText, Margin = new Padding(0, 0, 0, 14) };
            grid.Controls.Add(title, 1, 0);
            grid.Controls.Add(version, 1, 1);
            grid.Controls.Add(status, 1, 2);
            grid.Controls.Add(data, 1, 3);
            grid.Controls.Add(program, 1, 4);
            grid.Controls.Add(made, 1, 5);

            FlowLayoutPanel buttons = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, FlowDirection = FlowDirection.LeftToRight, WrapContents = false, Margin = new Padding(0) };
            Button updates = new Button { Text = "Check for updates", AutoSize = true, Padding = new Padding(6, 2, 6, 2) };
            updates.Click += delegate { tray.OpenPage("/#about"); };
            Button folder = new Button { Text = "Open data folder", AutoSize = true, Padding = new Padding(6, 2, 6, 2) };
            folder.Click += delegate { try { Process.Start(new ProcessStartInfo(tray.Cfg.DataDir) { UseShellExecute = true }); } catch { } };
            Button close = new Button { Text = "Close", AutoSize = true, Padding = new Padding(6, 2, 6, 2), DialogResult = DialogResult.Cancel };
            close.Click += delegate { Close(); };
            buttons.Controls.AddRange(new Control[] { updates, folder, close });
            grid.Controls.Add(buttons, 1, 6);
            Controls.Add(grid);
            AcceptButton = close;
            CancelButton = close;
        }

        public void Fill()
        {
            version.Text = tray.Version != "" ? "Version " + tray.Version : "";
            switch (tray.Status)
            {
                case State.Running: status.Text = "Running at " + tray.Cfg.Url; break;
                case State.Starting: status.Text = "Starting…"; break;
                case State.Stopping: status.Text = "Stopping…"; break;
                default: status.Text = "Not running"; break;
            }
            data.Text = "Data: " + tray.Cfg.DataDir;
            program.Text = "Program: " + tray.Dir;
        }
    }
}
