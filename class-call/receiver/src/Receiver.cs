// Classroom call receiver (single exe)
//
// Runs on a classroom PC. On first start it asks for a name for this place
// ("3학년 2반", "과학실") and the web app address (pre-filled, editable), and can
// register itself to start with Windows. Every few seconds it checks in with
// the Apps Script web app; messages sent to this place pop up in a window that
// stays on top of everything, with a sound and a spoken announcement.
//
// Build with build.bat (uses the C# compiler that ships with .NET Framework 4.x).

using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Net;
using System.Runtime.InteropServices;
using System.Speech.Synthesis;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;

static class Program
{
    public const string DefaultUrl = "https://script.google.com/macros/s/AKfycbwxJPJ4BaK5eLd9CiOWx6oTylQo88KYPXc6VekGDLPjdVhU_1uqVzjI9I5cC9ZV3Pgq/exec";
    public const string Title = "교실 호출 수신기";

    [DllImport("user32.dll")]
    static extern bool SetProcessDPIAware();

    [STAThread]
    static void Main()
    {
        bool first;
        using (var mutex = new Mutex(true, "ClassCallReceiver", out first))
        {
            if (!first)
            {
                MessageBox.Show("교실 호출 수신기가 이미 켜져 있어요.\n\n화면 오른쪽 아래 트레이(시계 옆 ^)의 아이콘을 오른쪽 클릭하면 설정을 바꾸거나 종료할 수 있어요.",
                    Title, MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            try { SetProcessDPIAware(); } catch { }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            ServicePointManager.SecurityProtocol = (SecurityProtocolType)3072; // TLS 1.2

            Settings settings = Settings.Load();
            if (settings.Name == "" && !SettingsForm.Edit(settings)) return; // cancelled on first run
            Settings.ApplyAutoStart(settings.AutoStart);
            Application.Run(new ReceiverContext(settings));
        }
    }
}

// ----- Settings: %APPDATA%\ClassCall\settings.txt -----

class Settings
{
    public string Name = "";
    public string Url = Program.DefaultUrl;
    public bool AutoStart = true;

    static string Dir
    {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "ClassCall"); }
    }

    static string FilePath
    {
        get { return Path.Combine(Dir, "settings.txt"); }
    }

    public static Settings Load()
    {
        var s = new Settings();
        try
        {
            if (!File.Exists(FilePath)) return s;
            foreach (string line in File.ReadAllLines(FilePath, Encoding.UTF8))
            {
                int i = line.IndexOf('=');
                if (i < 0) continue;
                string key = line.Substring(0, i).Trim();
                string value = line.Substring(i + 1).Trim();
                if (key == "name") s.Name = value;
                else if (key == "url" && value != "") s.Url = value;
                else if (key == "autostart") s.AutoStart = value != "0";
            }
        }
        catch { }
        return s;
    }

    public void Save()
    {
        Directory.CreateDirectory(Dir);
        File.WriteAllLines(FilePath, new[] { "name=" + Name, "url=" + Url, "autostart=" + (AutoStart ? "1" : "0") },
            new UTF8Encoding(false));
    }

    // Start with Windows through the per-user Run key (no admin rights needed).
    // Written on every start, so it follows the exe if it is moved.
    public static void ApplyAutoStart(bool on)
    {
        try
        {
            using (RegistryKey key = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true))
            {
                if (key == null) return;
                if (on) key.SetValue("ClassCallReceiver", "\"" + Application.ExecutablePath + "\"");
                else if (key.GetValue("ClassCallReceiver") != null) key.DeleteValue("ClassCallReceiver");
            }
        }
        catch { }
    }
}

// ----- Settings window -----

class SettingsForm : Form
{
    readonly TextBox nameBox = new TextBox();
    readonly TextBox urlBox = new TextBox();
    readonly Button editUrl = new Button();
    readonly CheckBox autoStart = new CheckBox();
    readonly Settings settings;

    // Shows the window; returns true (and saves) when the user presses 확인.
    public static bool Edit(Settings s)
    {
        using (var f = new SettingsForm(s)) return f.ShowDialog() == DialogResult.OK;
    }

    SettingsForm(Settings s)
    {
        settings = s;
        Text = Program.Title;
        Font = new Font("Malgun Gothic", 10f);
        AutoScaleMode = AutoScaleMode.Dpi;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true;
        ClientSize = new Size(520, 300);

        var ask = new Label { Text = "이곳의 이름을 무엇으로 하시겠습니까?", Location = new Point(20, 18), AutoSize = true,
            Font = new Font("Malgun Gothic", 11f, FontStyle.Bold) };
        var example = new Label { Text = "예: 3학년 2반, 과학실, 교무실", Location = new Point(20, 46), AutoSize = true, ForeColor = Color.DimGray };
        nameBox.SetBounds(20, 72, 480, 30);
        nameBox.MaxLength = 20;
        nameBox.Text = s.Name;

        var urlLabel = new Label { Text = "웹 앱 주소", Location = new Point(20, 118), AutoSize = true };
        urlBox.SetBounds(20, 144, 390, 30);
        urlBox.Text = s.Url;
        urlBox.ReadOnly = true;
        editUrl.Text = "수정";
        editUrl.SetBounds(420, 142, 80, 30);
        editUrl.Click += delegate
        {
            urlBox.ReadOnly = false;
            urlBox.Focus();
            urlBox.SelectAll();
        };

        autoStart.Text = "컴퓨터를 켤 때 자동으로 실행";
        autoStart.Checked = s.AutoStart;
        autoStart.SetBounds(20, 190, 480, 28);

        var ok = new Button { Text = "확인", DialogResult = DialogResult.None };
        ok.SetBounds(300, 240, 95, 36);
        ok.Click += delegate { Confirm(); };
        var cancel = new Button { Text = "취소", DialogResult = DialogResult.Cancel };
        cancel.SetBounds(405, 240, 95, 36);

        Controls.AddRange(new Control[] { ask, example, nameBox, urlLabel, urlBox, editUrl, autoStart, ok, cancel });
        AcceptButton = ok;
        CancelButton = cancel;
        // CenterScreen alone can land off-center (e.g. with two monitors), so place it explicitly.
        StartPosition = FormStartPosition.Manual;
        Load += delegate
        {
            Rectangle a = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(a.Left + (a.Width - Width) / 2, a.Top + (a.Height - Height) / 2);
        };
        Shown += delegate
        {
            Activate();
            nameBox.Focus();
        };
    }

    void Confirm()
    {
        string name = nameBox.Text.Trim();
        string url = urlBox.Text.Trim();
        if (name == "")
        {
            MessageBox.Show(this, "이름을 적어 주세요.", Program.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            nameBox.Focus();
            return;
        }
        if (!url.StartsWith("https://script.google.com/") || !url.Contains("/exec"))
        {
            MessageBox.Show(this, "웹 앱 주소는 https://script.google.com/ 으로 시작하고 /exec 로 끝나야 해요.",
                Program.Title, MessageBoxButtons.OK, MessageBoxIcon.Warning);
            urlBox.ReadOnly = false;
            urlBox.Focus();
            return;
        }
        settings.Name = name;
        settings.Url = url;
        settings.AutoStart = autoStart.Checked;
        try { settings.Save(); }
        catch (Exception e)
        {
            MessageBox.Show(this, "설정을 저장하지 못했어요: " + e.Message, Program.Title, MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        DialogResult = DialogResult.OK;
    }
}

// ----- Tray icon, polling, and the message queue -----

class LoginRequiredException : Exception { }

class ReceiverContext : ApplicationContext
{
    const int PollMs = 5000;
    const int SpeakTimes = 2;

    readonly Settings settings;
    readonly NotifyIcon tray = new NotifyIcon();
    readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer();
    readonly Control ui = new Control();          // marshals network results back to the UI thread
    readonly Queue<Dictionary<string, object>> queue = new Queue<Dictionary<string, object>>();
    SpeechSynthesizer synth;
    MessageForm popup;
    long after = -1;       // id of the last message already handled
    int generation;        // bumped when settings change, so stale answers are ignored
    bool busy;
    string lastStatus = "";

    public ReceiverContext(Settings s)
    {
        settings = s;
        ui.CreateControl();
        IntPtr unused = ui.Handle;

        try
        {
            synth = new SpeechSynthesizer();
            foreach (InstalledVoice v in synth.GetInstalledVoices())
            {
                if (v.Enabled && v.VoiceInfo.Culture.Name == "ko-KR") { synth.SelectVoice(v.VoiceInfo.Name); break; }
            }
        }
        catch { synth = null; }

        var menu = new ContextMenuStrip();
        menu.Items.Add("설정 (이름 · 주소)", null, delegate { OpenSettings(); });
        menu.Items.Add("테스트 메시지 띄우기", null, delegate
        {
            var test = new Dictionary<string, object>();
            test["id"] = 0;
            test["text"] = "홍길동 지금 교무실로 와라";
            test["from"] = "테스트";
            queue.Enqueue(test);
            ShowNext();
        });
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("종료", null, delegate { Quit(); });

        tray.Icon = SystemIcons.Information;
        tray.ContextMenuStrip = menu;
        tray.Visible = true;
        tray.DoubleClick += delegate { OpenSettings(); };
        SetStatus("연결하는 중", false);

        timer.Interval = PollMs;
        timer.Tick += delegate { Poll(); };
        timer.Start();
        Poll();
    }

    void OpenSettings()
    {
        if (!SettingsForm.Edit(settings)) return;
        Settings.ApplyAutoStart(settings.AutoStart);
        generation++;
        after = -1;           // start fresh under the new name / address
        busy = false;
        lastStatus = "";
        SetStatus("연결하는 중", false);
        Poll();
    }

    void Quit()
    {
        timer.Stop();
        tray.Visible = false;
        tray.Dispose();
        ExitThread();
    }

    string BuildUrl(string mode, string extra)
    {
        string sep = settings.Url.Contains("?") ? "&" : "?";
        return settings.Url + sep + "mode=" + mode + "&name=" + Uri.EscapeDataString(settings.Name) + extra;
    }

    // GET a URL and parse the JSON answer. Apps Script answers through a redirect;
    // ending up on a Google sign-in page means the deployment is not open to "Anyone".
    static Dictionary<string, object> GetJson(string url)
    {
        var req = (HttpWebRequest)WebRequest.Create(url);
        req.Timeout = 10000;
        req.AllowAutoRedirect = true;
        using (var res = (HttpWebResponse)req.GetResponse())
        {
            string path = res.ResponseUri.AbsolutePath;
            if (path.Contains("ServiceLogin") || path.Contains("signin") || path.Contains("AccountChooser"))
                throw new LoginRequiredException();
            using (var reader = new StreamReader(res.GetResponseStream(), Encoding.UTF8))
            {
                return new JavaScriptSerializer().DeserializeObject(reader.ReadToEnd()) as Dictionary<string, object>;
            }
        }
    }

    void Poll()
    {
        if (busy) return;
        busy = true;
        int gen = generation;
        string url = BuildUrl("poll", "&after=" + after);
        ThreadPool.QueueUserWorkItem(delegate
        {
            Dictionary<string, object> result = null;
            Exception error = null;
            try { result = GetJson(url); }
            catch (Exception e) { error = e; }
            try { ui.BeginInvoke((Action)delegate { OnPolled(gen, result, error); }); }
            catch { }   // closing down
        });
    }

    void OnPolled(int gen, Dictionary<string, object> r, Exception error)
    {
        if (gen != generation) return;
        busy = false;
        if (error is LoginRequiredException)
        {
            SetStatus("연결 안 됨: 배포의 액세스 권한을 '모든 사용자'로 바꿔 주세요", true);
            return;
        }
        if (error != null || r == null)
        {
            SetStatus("연결 안 됨: 웹 앱 주소나 인터넷 연결을 확인해 주세요", true);
            return;
        }
        if (r.ContainsKey("error"))
        {
            SetStatus("연결 안 됨: " + r["error"], true);
            return;
        }
        SetStatus("연결됨", false);

        object[] messages = r.ContainsKey("messages") ? r["messages"] as object[] : null;
        if (messages != null)
        {
            foreach (object m in messages)
            {
                var msg = m as Dictionary<string, object>;
                if (msg != null) queue.Enqueue(msg);
            }
        }
        long latest = r.ContainsKey("latest") ? Convert.ToInt64(r["latest"]) : after;
        if (latest > after) after = latest;
        ShowNext();
    }

    // The tray icon is often hidden behind the ^ arrow, so a bubble pops up whenever the status changes.
    void SetStatus(string text, bool problem)
    {
        string tip = "교실 호출 · " + settings.Name + " · " + text;
        tray.Text = tip.Length > 63 ? tip.Substring(0, 63) : tip;
        if (text == lastStatus) return;
        lastStatus = text;
        tray.ShowBalloonTip(4000, "교실 호출 · " + settings.Name, text, problem ? ToolTipIcon.Warning : ToolTipIcon.Info);
    }

    void ShowNext()
    {
        if (popup != null || queue.Count == 0) return;
        Dictionary<string, object> m = queue.Dequeue();
        popup = new MessageForm(m);
        popup.FormClosed += delegate { popup = null; ShowNext(); };
        popup.Show();
        popup.Activate();
        Speak(MessageForm.Field(m, "text"));
    }

    void Speak(string text)
    {
        System.Media.SystemSounds.Exclamation.Play();
        if (synth == null || text == "") return;
        try
        {
            synth.SpeakAsyncCancelAll();
            for (int i = 0; i < SpeakTimes; i++) synth.SpeakAsync(text);
        }
        catch { }
    }
}

// ----- The red message window -----

class MessageForm : Form
{
    static readonly Color Red = Color.FromArgb(217, 48, 37);
    static readonly Color DarkRed = Color.FromArgb(150, 20, 15);

    readonly long id;
    readonly System.Windows.Forms.Timer blink = new System.Windows.Forms.Timer();
    int blinks;

    public static string Field(Dictionary<string, object> m, string key)
    {
        object v;
        return m.TryGetValue(key, out v) && v != null ? v.ToString() : "";
    }

    public MessageForm(Dictionary<string, object> m)
    {
        id = Convert.ToInt64(m.ContainsKey("id") ? m["id"] : 0);
        string text = Field(m, "text");
        string from = Field(m, "from");

        Rectangle area = Screen.PrimaryScreen.WorkingArea;
        FormBorderStyle = FormBorderStyle.None;
        StartPosition = FormStartPosition.CenterScreen;
        TopMost = true;
        ShowInTaskbar = false;
        Width = (int)(area.Width * 0.72);
        Height = (int)(area.Height * 0.6);
        BackColor = Red;
        int h = Height;

        var grid = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(28), ColumnCount = 1, RowCount = 3 };
        grid.RowStyles.Add(new RowStyle(SizeType.Percent, 14));
        grid.RowStyles.Add(new RowStyle(SizeType.Percent, 62));
        grid.RowStyles.Add(new RowStyle(SizeType.Percent, 24));

        // Message ids are the millisecond time it was sent (the test message has id 0)
        DateTime sent = id > 0 ? new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc).AddMilliseconds(id).ToLocalTime() : DateTime.Now;
        string head = (from != "" ? from : "메시지") + " · " + sent.ToString("HH:mm");

        // Shorter messages get bigger letters
        float size = text.Length <= 20 ? h * 0.11f : text.Length <= 60 ? h * 0.075f : h * 0.05f;

        grid.Controls.Add(MakeLabel(head, h * 0.05f, false), 0, 0);
        grid.Controls.Add(MakeLabel(text, size, true), 0, 1);

        var ok = new Button
        {
            Text = "확인",
            Anchor = AnchorStyles.None,
            Width = (int)(Width * 0.25),
            Height = (int)(h * 0.15),
            FlatStyle = FlatStyle.Flat,
            BackColor = Color.White,
            ForeColor = Red,
            Font = new Font("Malgun Gothic", h * 0.06f, FontStyle.Bold, GraphicsUnit.Pixel)
        };
        ok.Click += delegate { Close(); };
        grid.Controls.Add(ok, 0, 2);
        Controls.Add(grid);
        AcceptButton = ok;

        // Flash for the first few seconds so it is noticed
        blink.Interval = 450;
        blink.Tick += delegate
        {
            blinks++;
            BackColor = blinks % 2 == 1 ? DarkRed : Red;
            if (blinks >= 12) { blink.Stop(); BackColor = Red; }
        };
        Shown += delegate { blink.Start(); };
        FormClosed += delegate { blink.Stop(); blink.Dispose(); };
    }

    static Label MakeLabel(string text, float px, bool bold)
    {
        return new Label
        {
            Text = text,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleCenter,
            ForeColor = Color.White,
            UseMnemonic = false,
            Font = new Font("Malgun Gothic", px, bold ? FontStyle.Bold : FontStyle.Regular, GraphicsUnit.Pixel)
        };
    }
}
