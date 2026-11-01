#include "appcontroller.h"
#include "platform/windowchrome.h"
#include <QApplication>
#include <QDir>
#include <QFile>
#include <QJsonDocument>
#include <QQmlApplicationEngine>
#include <QQmlContext>
#include <QQuickItem>
#include <QQuickStyle>
#include <QQuickWindow>
#include <QStyleHints>
#include <QTemporaryDir>
#include <QtTest>

class UiTest : public QObject {
    Q_OBJECT
    std::unique_ptr<QTemporaryDir> directory;
    std::unique_ptr<AppController> backend;
    WindowChrome chrome;
    std::unique_ptr<QQmlApplicationEngine> engine;
    QQuickWindow *window = nullptr;
    QStringList warnings;
    void load() {
        engine = std::make_unique<QQmlApplicationEngine>();
        connect(engine.get(), &QQmlEngine::warnings, this, [this](const QList<QQmlError> &errors) {
            for (const auto &error : errors) warnings.append(error.toString());
        });
        engine->rootContext()->setContextProperty("backend", backend.get());
        engine->rootContext()->setContextProperty("windowChrome", &chrome);
        engine->rootContext()->setContextProperty("startupCustomTitleBar", backend->customTitleBar());
        engine->rootContext()->setContextProperty("trayAvailable", true);
        engine->load(QUrl("qrc:/qdm-ui-test/Main.qml"));
        QVERIFY2(!engine->rootObjects().isEmpty(), qPrintable(warnings.join('\n')));
        window = qobject_cast<QQuickWindow *>(engine->rootObjects().first());
        QVERIFY(window);
        QVERIFY(QTest::qWaitForWindowExposed(window));
    }
    QQuickItem *findItem(QQuickItem *root, const QString &name) {
        if (root->objectName() == name) return root;
        for (auto child : root->childItems()) if (auto found = findItem(child, name)) return found;
        return nullptr;
    }
    QQuickItem *item(const QString &name) { return findItem(window->contentItem(), name); }
    void click(const QString &name) {
        QQuickItem *target = nullptr;
        QTRY_VERIFY2((target = item(name)) && target->isVisible(), qPrintable("Missing visible control: " + name));
        // A newly shown settings page needs a polish/render pass before its
        // delegates have their final hit-test coordinates.
        QTest::qWait(60);
        const auto point = target->mapToScene(QPointF(target->width() / 2, target->height() / 2)).toPoint();
        QVERIFY(window->geometry().size().width() > point.x() && window->height() > point.y());
        QTest::mouseClick(window, Qt::LeftButton, Qt::NoModifier, point);
    }
private slots:
    void initTestCase() {
        QQuickStyle::setStyle("Basic");
        QApplication::setQuitOnLastWindowClosed(false);
    }
    void init() {
        warnings.clear();
        directory = std::make_unique<QTemporaryDir>();
        backend = std::make_unique<AppController>(directory->path());
        backend->chooseFolder(QUrl::fromLocalFile(directory->filePath("downloads")));
        backend->finishSetup();
        load();
    }
    void cleanup() {
        engine.reset(); window = nullptr;
        backend.reset(); directory.reset();
        QGuiApplication::styleHints()->unsetColorScheme();
        QVERIFY2(warnings.isEmpty(), qPrintable(warnings.join('\n')));
    }
    void themeButtonsAndAllPalettesRender() {
        click("themeToggle");
        QTRY_COMPARE(backend->colorScheme(), "light");
        QTRY_VERIFY(!window->property("darkTheme").toBool());
        click("settingsButton");
        QTRY_VERIFY(window->property("settingsOpen").toBool());
        click("palette_teal"); QCOMPARE(backend->themePalette(), "teal");
        click("scheme_dark"); QCOMPARE(backend->colorScheme(), "dark");
        const QStringList palettes{"teal", "blurple", "blue", "grey"};
        const QStringList dark{"#0c1619", "#161826", "#1c1c1e", "#141414"};
        const QStringList light{"#e9f3f4", "#eef0f7", "#f2f2f7", "#ededed"};
        const auto captureDir = qEnvironmentVariable("QDM_UI_CAPTURE_DIR");
        if (!captureDir.isEmpty()) QVERIFY(QDir().mkpath(captureDir));
        QJsonObject capturedThemes;
        for (int at = 0; at < palettes.size(); ++at) {
            backend->setThemePalette(palettes[at]);
            for (const auto &scheme : {QString("dark"), QString("light")}) {
                backend->setColorScheme(scheme);
                const QColor expected(scheme == "dark" ? dark[at] : light[at]);
                QTRY_COMPARE(window->property("themeBackground").value<QColor>(), expected);
                QTest::qWait(60);
                const auto image = window->grabWindow();
                QVERIFY(!image.isNull());
                QCOMPARE(image.pixelColor(2, qRound(100 * window->devicePixelRatio())), expected);
                const auto appearance = backend->handle({{"v", 1}, {"id", "theme"}, {"type", "hello"}}, "browser").value("appearance").toObject();
                QCOMPARE(appearance.value("palette").toString(), palettes[at]);
                QCOMPARE(appearance.value("colorScheme").toString(), scheme);
                QCOMPARE(appearance.value("resolvedScheme").toString(), scheme);
                const auto colors = appearance.value("colors").toObject();
                QCOMPARE(colors.value("bg").toString(), expected.name());
                QCOMPARE(colors.size(), 12);
                capturedThemes.insert(palettes[at] + '-' + scheme, appearance);
                if (!captureDir.isEmpty()) QVERIFY(image.save(QDir(captureDir).filePath(palettes[at] + '-' + scheme + ".png")));
            }
        }
        if (!captureDir.isEmpty()) {
            QFile file(QDir(captureDir).filePath("themes.json"));
            QVERIFY(file.open(QIODevice::WriteOnly));
            QVERIFY(file.write(QJsonDocument(capturedThemes).toJson()) > 0);
        }
        click("backButton"); QTRY_VERIFY(!window->property("settingsOpen").toBool());
    }
    void followsSystemScheme() {
        backend->setColorScheme("system");
        QGuiApplication::styleHints()->setColorScheme(Qt::ColorScheme::Light);
        QTRY_VERIFY(!window->property("darkTheme").toBool());
        QGuiApplication::styleHints()->setColorScheme(Qt::ColorScheme::Dark);
        // Some offscreen plugins report Light regardless of the requested override.
        const bool dark = QGuiApplication::styleHints()->colorScheme() == Qt::ColorScheme::Dark;
        QTRY_COMPARE(window->property("darkTheme").toBool(), dark);
        const auto appearance = backend->handle({{"v", 1}, {"id", "theme"}, {"type", "status"}}, "browser").value("appearance").toObject();
        QCOMPARE(appearance.value("colorScheme").toString(), "system");
        QCOMPARE(appearance.value("resolvedScheme").toString(), dark ? "dark" : "light");
        QCOMPARE(QColor(appearance.value("colors").toObject().value("bg").toString()), window->property("themeBackground").value<QColor>());
    }
    void titleBarHasRoomForNativeControlsAndFallbackPersists() {
        auto bar = item("titleBar"); QVERIFY(bar);
        QVERIFY(bar->height() >= 48);
        QVERIFY(window->property("customChrome").toBool());
        if (QGuiApplication::platformName() == "cocoa") {
            QTRY_VERIFY(!chrome.metrics(window).isEmpty());
            const auto metrics = chrome.metrics(window);
            const auto inset = metrics.value("leftInset").toInt();
            QVERIFY(inset > 50 && inset < 120);
            QTRY_VERIFY(bar->property("leftInset").toInt() >= inset);
            QTRY_VERIFY(bar->height() >= metrics.value("lightsCenterY").toInt() * 2);
        }
        const auto flags = window->flags();
        backend->setCustomTitleBar(false);
        QCOMPARE(window->flags(), flags); // Preference takes effect on restart only.
        engine.reset(); window = nullptr;
        load();
        QVERIFY(!window->property("customChrome").toBool());
        QVERIFY(!window->flags().testFlag(Qt::ExpandedClientAreaHint));
        QVERIFY(!window->flags().testFlag(Qt::FramelessWindowHint));
    }
    void titleBarButtonsDoNotDragAndCloseHonorsTraySetting() {
        const auto position = window->position();
        click("addLinkButton");
        QCOMPARE(window->position(), position);
        QTest::keyClick(window, Qt::Key_Escape);
        backend->setKeepInTray(true);
        QVERIFY(!window->close());
        QVERIFY(!window->isVisible());
        window->show();
        QVERIFY(QTest::qWaitForWindowExposed(window));
        backend->setKeepInTray(false);
        QVERIFY(window->close());
        QVERIFY(!window->isVisible());
    }
};
QTEST_MAIN(UiTest)
#include "ui_test.moc"
