cmake_minimum_required(VERSION 3.21)
project(QDownloadManager VERSION 0.2.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
find_package(Qt6 6.5 REQUIRED COMPONENTS Core Gui Network Qml Quick QuickControls2 Widgets)
qt_standard_project_setup(REQUIRES 6.5)
if(Qt6_VERSION VERSION_GREATER_EQUAL 6.8)
    qt_policy(SET QTP0004 NEW)
endif()

file(READ "${CMAKE_CURRENT_SOURCE_DIR}/extension/identity.json" IDENTITY)
string(JSON NATIVE_HOST GET "${IDENTITY}" host)
string(JSON EXTENSION_ID GET "${IDENTITY}" extensionId)
configure_file(src/common/identity.h.in generated/identity.h @ONLY)

add_library(qdm_common STATIC src/common/protocol.cpp src/common/localendpoint.cpp)
target_include_directories(qdm_common PUBLIC src/common "${CMAKE_CURRENT_BINARY_DIR}/generated")
target_link_libraries(qdm_common PUBLIC Qt6::Core Qt6::Network)

add_library(qdm_backend STATIC src/app/downloadmanager.cpp src/app/downloadlistmodel.cpp src/app/appcontroller.cpp src/app/localserver.cpp)
target_include_directories(qdm_backend PUBLIC src/app)
target_link_libraries(qdm_backend PUBLIC qdm_common Qt6::Gui)
target_compile_definitions(qdm_backend PRIVATE QDM_EXTENSION_DIR="${CMAKE_CURRENT_SOURCE_DIR}/extension")

qt_add_executable(qdownloadmanager MACOSX_BUNDLE src/app/main.cpp)
target_link_libraries(qdownloadmanager PRIVATE qdm_backend Qt6::Quick Qt6::QuickControls2 Qt6::Widgets)
set_source_files_properties(qml/Theme.qml PROPERTIES QT_QML_SINGLETON_TYPE TRUE)
qt_add_qml_module(qdownloadmanager URI DownloadHelper VERSION 1.0
    QML_FILES qml/Main.qml qml/Theme.qml qml/ActionButton.qml qml/Icon.qml qml/SectionLabel.qml qml/DownloadCard.qml)
set_target_properties(qdownloadmanager PROPERTIES
    MACOSX_BUNDLE_BUNDLE_NAME "Download Helper"
    MACOSX_BUNDLE_GUI_IDENTIFIER "cc.qdownloadmanager.app"
    MACOSX_BUNDLE_BUNDLE_VERSION "${PROJECT_VERSION}"
    MACOSX_BUNDLE_SHORT_VERSION_STRING "${PROJECT_VERSION}"
    WIN32_EXECUTABLE TRUE)

add_executable(qdm-native-host src/bridge/main.cpp)
target_link_libraries(qdm-native-host PRIVATE qdm_common)
if(APPLE)
    set_target_properties(qdm-native-host PROPERTIES RUNTIME_OUTPUT_DIRECTORY "${CMAKE_CURRENT_BINARY_DIR}/qdownloadmanager.app/Contents/MacOS")
endif()
add_dependencies(qdownloadmanager qdm-native-host)

include(CTest)
if(BUILD_TESTING)
    find_package(Qt6 REQUIRED COMPONENTS Test)
    qt_add_executable(qdm-tests tests/backend_test.cpp)
    target_link_libraries(qdm-tests PRIVATE qdm_backend Qt6::Test)
    add_test(NAME backend COMMAND qdm-tests)
endif()

install(TARGETS qdownloadmanager BUNDLE DESTINATION . RUNTIME DESTINATION bin)
if(APPLE)
    install(TARGETS qdm-native-host RUNTIME DESTINATION qdownloadmanager.app/Contents/MacOS)
    install(DIRECTORY extension DESTINATION qdownloadmanager.app/Contents/MacOS)
else()
    install(TARGETS qdm-native-host RUNTIME DESTINATION bin)
    install(DIRECTORY extension DESTINATION bin)
endif()
