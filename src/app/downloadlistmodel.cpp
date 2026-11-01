#include "downloadlistmodel.h"
#include <QSet>

QVariant DownloadListModel::data(const QModelIndex &index, int role) const
{
    if (!index.isValid() || index.row() < 0 || index.row() >= m_rows.size() || role != Qt::UserRole) return {};
    return m_rows.at(index.row());
}

void DownloadListModel::update(const QVariantList &rows)
{
    auto id = [](const QVariant &row) { return row.toMap().value("jobId").toString(); };
    QSet<QString> wanted;
    for (const auto &row : rows) wanted.insert(id(row));
    for (int i = int(m_rows.size()) - 1; i >= 0; --i) {
        if (!wanted.contains(id(m_rows.at(i)))) {
            beginRemoveRows({}, i, i); m_rows.removeAt(i); endRemoveRows();
        }
    }
    for (int i = 0; i < rows.size(); ++i) {
        int existing = -1;
        for (int j = i; j < m_rows.size(); ++j) if (id(m_rows.at(j)) == id(rows.at(i))) { existing = j; break; }
        if (existing < 0) { beginInsertRows({}, i, i); m_rows.insert(i, rows.at(i)); endInsertRows(); }
        else {
            if (existing != i) { beginMoveRows({}, existing, existing, {}, i); m_rows.move(existing, i); endMoveRows(); }
            if (m_rows.at(i) != rows.at(i)) { m_rows[i] = rows.at(i); emit dataChanged(index(i), index(i), {Qt::UserRole}); }
        }
    }
}
