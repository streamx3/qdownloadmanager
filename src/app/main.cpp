#include "appcontroller.h"
#include "localendpoint.h"
#include "localserver.h"
#include "identity.h"
#include "platform/windowchrome.h"
#include <QApplication>
#include <QCommandLineParser>
#include <QDir>
#include <QIcon>
#include <QLockFile>
#include <QMenu>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickStyle>
#include <QQuickWindow>
#include <QSystemTrayIcon>
#include <QTimer>

int main(int argc, char *argv[])
{
    QApplication app(argc, argv);
    app.setOrganizationName("QDownloadManager");
    app.setApplicationName("QDownloadManager");
    app.setApplicationDisplayName("QDownloadManager");
    app.setApplicationVersion(Identity::Version);
    QQuickStyle::setStyle("Basic");
    QCommandLineParser parser;
    parser.setApplicationDescription("QDownloadManager — images from Chrome, saved locally.");
    parser.addHelpOption();
    parser.addVersionOption();
    parser.addOptions({{"settings", "Open the Settings screen."},
                       {"native-title-bar", "Use the system title bar for this launch."},
                       {"data-dir", "Use an isolated settings and IPC directory.", "path"},
                       {"screenshot", "Save a window capture after rendering.", "path"},
                       {"quit-after", "Exit after a specified number of milliseconds (smoke tests).", "milliseconds"}});
    parser.process(app);
    const auto directory = parser.isSet("data-dir") ? QDir(parser.value("data-dir")).absolutePath()
        : qEnvironmentVariable("QDM_DATA_DIR", LocalEndpoint::dataDirectory());
    if (!LocalEndpoint::prepareDirectory(directory)) { qCritical("Cannot create private app data directory."); return 1; }
    QLockFile instance(QDir(directory).filePath("app.lock"));
    if (!instance.tryLock(0)) { qCritical("QDownloadManager is already running for this data directory."); return 1; }
    AppController controller(directory);
    LocalServer server(controller);
    QObject::connect(&app, &QCoreApplication::aboutToQuit, &controller, [&] {
        server.shutdown();
        controller.shutdown();
    });
    if (!server.listen(LocalEndpoint::name(directory))) controller.setServerError("Could not listen for Chrome: " + server.errorString());

    QIcon icon;
    for (const auto size : {16, 32, 48, 64, 128, 256, 512, 1024})
        icon.addFile(QString(":/icons/qdownloadmanager-%1.png").arg(size), QSize(size, size));
    app.setWindowIcon(icon);

    WindowChrome windowChrome;
    QQmlApplicationEngine engine;
    engine.rootContext()->setContextProperty("windowChrome", &windowChrome);
    engine.rootContext()->setContextProperty("startupCustomTitleBar", controller.customTitleBar() && !parser.isSet("native-title-bar"));
    engine.rootContext()->setContextProperty("backend", &controller);
    engine.rootContext()->setContextProperty("trayAvailable", QSystemTrayIcon::isSystemTrayAvailable());
    engine.loadFromModule("QDownloadManager", "Main");
    if (engine.rootObjects().isEmpty()) return 1;
    auto window = qobject_cast<QQuickWindow *>(engine.rootObjects().first());
    if (!window) return 1;
    if (parser.isSet("settings")) window->setProperty("settingsOpen", true);

    QSystemTrayIcon tray(icon);
    tray.setToolTip("QDownloadManager");
    QMenu trayMenu;
    auto show = [&] { window->show(); window->raise(); window->requestActivate(); };
    trayMenu.addAction("Open QDownloadManager", &app, show);
    trayMenu.addAction("Open download folder", &controller, &AppController::openFolder);
    trayMenu.addSeparator();
    trayMenu.addAction("Quit", &app, &QApplication::quit);
    tray.setContextMenu(&trayMenu);
    QObject::connect(&tray, &QSystemTrayIcon::activated, &app, [&](QSystemTrayIcon::ActivationReason reason) {
        if (reason == QSystemTrayIcon::Trigger || reason == QSystemTrayIcon::DoubleClick) show();
    });
    auto updateTray = [&] {
        const bool keep = controller.keepInTray() && QSystemTrayIcon::isSystemTrayAvailable();
        app.setQuitOnLastWindowClosed(!keep);
        tray.setVisible(keep || controller.notifications());
    };
    QObject::connect(&controller, &AppController::settingsChanged, &app, updateTray);
    QObject::connect(&controller, &AppController::downloadCompleted, &app, [&](const QString &name) {
        if (controller.notifications() && QSystemTrayIcon::supportsMessages()) tray.showMessage("Image saved", name, QSystemTrayIcon::Information, 4000);
    });
    updateTray();
    if (parser.isSet("screenshot")) QTimer::singleShot(1200, &app, [&] { window->grabWindow().save(parser.value("screenshot")); });
    if (parser.isSet("quit-after")) QTimer::singleShot(qMax(100, parser.value("quit-after").toInt()), &app, &QApplication::quit);
    return app.exec();
}
